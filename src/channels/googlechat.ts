/**
 * Google Chat channel for NanoClaw.
 *
 * Receives messages via Google Cloud Pub/Sub (no public URL needed).
 * Sends messages via the Google Chat API.
 *
 * Required env vars:
 *   GOOGLE_CHAT_SERVICE_ACCOUNT_KEY — path to service account JSON key file
 *   GOOGLE_CHAT_PROJECT_ID          — Google Cloud project ID
 *   GOOGLE_CHAT_SUBSCRIPTION_ID     — Pub/Sub subscription ID
 */

import { google, chat_v1 } from 'googleapis';
import { PubSub, Message as PubSubMessage } from '@google-cloud/pubsub';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import type { Channel, NewMessage } from '../types.js';

const JID_PREFIX = 'gchat:';

function spaceIdFromJid(jid: string): string {
  return jid.slice(JID_PREFIX.length); // e.g. "spaces/AAAA123"
}

class GoogleChatChannel implements Channel {
  name = 'googlechat';

  private chat: chat_v1.Chat;
  private pubsub: PubSub;
  private subscriptionId: string;
  private connected = false;
  private onMessage: ChannelOpts['onMessage'];
  private onChatMetadata: ChannelOpts['onChatMetadata'];
  private botUserId: string | null = null;

  constructor(
    chat: chat_v1.Chat,
    pubsub: PubSub,
    subscriptionId: string,
    opts: ChannelOpts,
  ) {
    this.chat = chat;
    this.pubsub = pubsub;
    this.subscriptionId = subscriptionId;
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
  }

  async connect(): Promise<void> {
    // Listen on Pub/Sub subscription for incoming Chat events
    const subscription = this.pubsub.subscription(this.subscriptionId);

    subscription.on('message', (msg: PubSubMessage) => {
      try {
        this.handlePubSubMessage(msg);
      } catch (err) {
        logger.error({ err }, 'Error handling Google Chat Pub/Sub message');
      }
      msg.ack();
    });

    subscription.on('error', (err: Error) => {
      logger.error({ err }, 'Google Chat Pub/Sub subscription error');
    });

    this.connected = true;
    logger.info('Google Chat channel connected via Pub/Sub');
  }

  private handlePubSubMessage(msg: PubSubMessage): void {
    const data = JSON.parse(msg.data.toString());

    // Google Chat events: MESSAGE, ADDED_TO_SPACE, REMOVED_FROM_SPACE, etc.
    const eventType: string = data.type;

    if (eventType === 'MESSAGE') {
      this.handleIncomingMessage(data);
    } else if (eventType === 'ADDED_TO_SPACE') {
      const space = data.space;
      if (space) {
        const jid = JID_PREFIX + space.name;
        const isGroup = space.type === 'ROOM' || space.type === 'SPACE';
        this.onChatMetadata(
          jid,
          new Date().toISOString(),
          space.displayName || space.name,
          'googlechat',
          isGroup,
        );
        logger.info({ space: space.name }, 'Bot added to Google Chat space');
      }
    }
  }

  private handleIncomingMessage(data: Record<string, unknown>): void {
    const message = data.message as Record<string, unknown>;
    const space = data.space as Record<string, unknown>;
    const sender = data.user as Record<string, unknown>;

    if (!message || !space || !sender) return;

    const text = (message.text as string) || '';
    if (!text.trim()) return;

    const spaceName = space.name as string; // e.g. "spaces/AAAA123"
    const jid = JID_PREFIX + spaceName;
    const messageName = message.name as string; // e.g. "spaces/AAAA123/messages/MSG123"
    const senderName =
      (sender.displayName as string) || (sender.name as string) || 'Unknown';
    const senderEmail =
      (sender.email as string) || (sender.name as string) || '';
    const isBot = sender.type === 'BOT';
    const createTime =
      (message.createTime as string) || new Date().toISOString();

    const isGroup = space.type === 'ROOM' || space.type === 'SPACE';

    // Report chat metadata
    this.onChatMetadata(
      jid,
      createTime,
      (space.displayName as string) || spaceName,
      'googlechat',
      isGroup,
    );

    const newMsg: NewMessage = {
      id: messageName,
      chat_jid: jid,
      sender: senderEmail,
      sender_name: senderName,
      content: text,
      timestamp: createTime,
      is_from_me: isBot && this.isSelf(sender),
      is_bot_message: isBot,
    };

    this.onMessage(jid, newMsg);
  }

  private isSelf(user: Record<string, unknown>): boolean {
    if (this.botUserId && user.name === this.botUserId) return true;
    return user.type === 'BOT';
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const spaceName = spaceIdFromJid(jid);

    // Split long messages (Google Chat limit is 4096 characters)
    const chunks = splitMessage(text, 4096);

    for (const chunk of chunks) {
      await this.chat.spaces.messages.create({
        parent: spaceName,
        requestBody: { text: chunk },
      });
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    logger.info('Google Chat channel disconnected');
  }

  async syncGroups(force: boolean): Promise<void> {
    try {
      const res = await this.chat.spaces.list({
        filter:
          'spaceType = "SPACE" OR spaceType = "GROUP_CHAT" OR spaceType = "DIRECT_MESSAGE"',
      });

      const spaces = res.data.spaces || [];
      for (const space of spaces) {
        if (!space.name) continue;
        const jid = JID_PREFIX + space.name;
        const isGroup =
          space.spaceType === 'SPACE' || space.spaceType === 'GROUP_CHAT';
        this.onChatMetadata(
          jid,
          new Date().toISOString(),
          space.displayName || space.name,
          'googlechat',
          isGroup,
        );
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to sync Google Chat spaces');
    }
  }
}

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    // Try to split on newline
    let splitIdx = remaining.lastIndexOf('\n', limit);
    if (splitIdx <= 0) splitIdx = limit;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n/, '');
  }
  return chunks;
}

// --- Self-registration ---

registerChannel('googlechat', (opts: ChannelOpts) => {
  const env = readEnvFile([
    'GOOGLE_CHAT_SERVICE_ACCOUNT_KEY',
    'GOOGLE_CHAT_PROJECT_ID',
    'GOOGLE_CHAT_SUBSCRIPTION_ID',
  ]);

  const keyPath =
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY ||
    env.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY;
  const projectId =
    process.env.GOOGLE_CHAT_PROJECT_ID || env.GOOGLE_CHAT_PROJECT_ID;
  const subscriptionId =
    process.env.GOOGLE_CHAT_SUBSCRIPTION_ID || env.GOOGLE_CHAT_SUBSCRIPTION_ID;

  if (!keyPath || !projectId || !subscriptionId) {
    return null; // Credentials missing — skip channel
  }

  // Authenticate with service account
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/chat.bot'],
  });

  google.options({ auth });

  const chat = google.chat({ version: 'v1', auth });
  const pubsub = new PubSub({ projectId, keyFilename: keyPath });

  return new GoogleChatChannel(chat, pubsub, subscriptionId, opts);
});

export { GoogleChatChannel };
