import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  Message,
  TextChannel,
} from 'discord.js';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, GROUPS_DIR, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface DiscordChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: DiscordChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: DiscordChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      // Ignore bot messages (including own)
      if (message.author.bot) return;

      const channelId = message.channelId;
      const chatJid = `dc:${channelId}`;
      let content = message.content;
      const timestamp = message.createdAt.toISOString();
      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;
      const sender = message.author.id;
      const msgId = message.id;

      // Determine chat name
      let chatName: string;
      if (message.guild) {
        const textChannel = message.channel as TextChannel;
        chatName = `${message.guild.name} #${textChannel.name}`;
      } else {
        chatName = senderName;
      }

      // Translate Discord @bot mentions into TRIGGER_PATTERN format.
      // Discord mentions look like <@botUserId> — these won't match
      // TRIGGER_PATTERN (e.g., ^@Andy\b), so we prepend the trigger
      // when the bot is @mentioned.
      if (this.client?.user) {
        const botId = this.client.user.id;
        const isBotMentioned =
          message.mentions.users.has(botId) ||
          content.includes(`<@${botId}>`) ||
          content.includes(`<@!${botId}>`);

        if (isBotMentioned) {
          // Strip the <@botId> mention to avoid visual clutter
          content = content
            .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
            .trim();
          // Prepend trigger if not already present
          if (!TRIGGER_PATTERN.test(content)) {
            content = `@${ASSISTANT_NAME} ${content}`;
          }
        }
      }

      // Handle attachments — store placeholders so the agent knows something was sent
      if (message.attachments.size > 0) {
        const attachmentDescriptions = [...message.attachments.values()].map(
          (att) => {
            const contentType = att.contentType || '';
            if (contentType.startsWith('image/')) {
              return `[Image: ${att.name || 'image'}]`;
            } else if (contentType.startsWith('video/')) {
              return `[Video: ${att.name || 'video'}]`;
            } else if (contentType.startsWith('audio/')) {
              return `[Audio: ${att.name || 'audio'}]`;
            } else {
              return `[File: ${att.name || 'file'}]`;
            }
          },
        );
        if (content) {
          content = `${content}\n${attachmentDescriptions.join('\n')}`;
        } else {
          content = attachmentDescriptions.join('\n');
        }
      }

      // Handle reply context — include who the user is replying to
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(
            message.reference.messageId,
          );
          const replyAuthor =
            repliedTo.member?.displayName ||
            repliedTo.author.displayName ||
            repliedTo.author.username;
          content = `[Reply to ${replyAuthor}] ${content}`;
        } catch {
          // Referenced message may have been deleted
        }
      }

      // Store chat metadata for discovery
      const isGroup = message.guild !== null;
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        chatName,
        'discord',
        isGroup,
      );

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Discord channel',
        );
        return;
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Discord message stored',
      );
    });

    // Handle errors gracefully
    this.client.on(Events.Error, (err) => {
      logger.error({ err: err.message }, 'Discord client error');
    });

    return new Promise<void>((resolve) => {
      this.client!.once(Events.ClientReady, (readyClient) => {
        logger.info(
          { username: readyClient.user.tag, id: readyClient.user.id },
          'Discord bot connected',
        );
        console.log(`\n  Discord bot: ${readyClient.user.tag}`);
        console.log(
          `  Use /chatid command or check channel IDs in Discord settings\n`,
        );
        resolve();
      });

      this.client!.login(this.botToken);
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }

    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !('send' in channel)) {
        logger.warn({ jid }, 'Discord channel not found or not text-based');
        return;
      }

      const textChannel = channel as TextChannel;

      // Extract [attachment:path] tags and resolve to host file paths
      const attachmentPattern = /\[attachment:([^\]]+)\]/g;
      const attachments: AttachmentBuilder[] = [];
      let cleanText = text;

      let match;
      while ((match = attachmentPattern.exec(text)) !== null) {
        const filePath = match[1].trim();
        const resolved = resolveAttachmentPath(filePath);
        if (resolved && fs.existsSync(resolved)) {
          attachments.push(new AttachmentBuilder(resolved));
          logger.debug({ jid, file: resolved }, 'Discord attachment resolved');
        } else {
          logger.warn(
            { jid, file: filePath },
            'Discord attachment not found or outside allowed paths',
          );
        }
      }
      cleanText = cleanText.replace(attachmentPattern, '').trim();

      // Discord has a 2000 character limit per message — split if needed
      const MAX_LENGTH = 2000;
      if (cleanText.length <= MAX_LENGTH) {
        await textChannel.send({
          content: cleanText || undefined,
          files: attachments.length > 0 ? attachments : undefined,
        });
      } else {
        // Send text in chunks, attach files to the last chunk
        const chunks: string[] = [];
        let remaining = cleanText;
        while (remaining.length > 0) {
          if (remaining.length <= MAX_LENGTH) {
            chunks.push(remaining);
            break;
          }
          let splitIdx = remaining.lastIndexOf('\n', MAX_LENGTH);
          if (splitIdx <= 0) splitIdx = MAX_LENGTH;
          chunks.push(remaining.slice(0, splitIdx));
          remaining = remaining.slice(splitIdx).replace(/^\n/, '');
        }
        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          await textChannel.send({
            content: chunks[i],
            files: isLast && attachments.length > 0 ? attachments : undefined,
          });
        }
      }
      logger.info(
        { jid, length: text.length, attachments: attachments.length },
        'Discord message sent',
      );
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.isReady();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('dc:');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Discord bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !isTyping) return;
    try {
      const channelId = jid.replace(/^dc:/, '');
      const channel = await this.client.channels.fetch(channelId);
      if (channel && 'sendTyping' in channel) {
        await (channel as TextChannel).sendTyping();
      }
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
    }
  }
}

/**
 * Resolve an attachment path from container-relative to host-absolute.
 * Container agents write files to /workspace/group/ which maps to groups/{folder}/ on the host.
 * Only allows files under the groups/ directory for security.
 */
function resolveAttachmentPath(filePath: string): string | null {
  // Container path: /workspace/group/filename.png → groups/{folder}/filename.png
  // The agent may also output a host-absolute path if it knows it.
  let resolved: string;

  if (filePath.startsWith('/workspace/group/')) {
    // Container-relative path — we can't know the exact group folder from here,
    // but the file will be in one of the groups/ subdirectories.
    // Search for it across all group folders.
    const relativePart = filePath.slice('/workspace/group/'.length);
    const groupDirs = fs.readdirSync(GROUPS_DIR).filter((d) => {
      try {
        return fs.statSync(path.join(GROUPS_DIR, d)).isDirectory();
      } catch {
        return false;
      }
    });
    for (const dir of groupDirs) {
      const candidate = path.join(GROUPS_DIR, dir, relativePart);
      if (fs.existsSync(candidate)) {
        resolved = candidate;
        break;
      }
    }
    if (!resolved!) return null;
  } else if (path.isAbsolute(filePath)) {
    resolved = filePath;
  } else {
    // Relative path — treat as relative to groups/
    resolved = path.resolve(GROUPS_DIR, filePath);
  }

  // Security: only allow files under groups/ or /tmp/
  const realPath = fs.realpathSync(resolved);
  const realGroups = fs.realpathSync(GROUPS_DIR);
  if (!realPath.startsWith(realGroups) && !realPath.startsWith('/tmp/')) {
    logger.warn(
      { filePath, resolved: realPath },
      'Attachment path outside allowed directories',
    );
    return null;
  }

  return realPath;
}

registerChannel('discord', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['DISCORD_BOT_TOKEN']);
  const token =
    process.env.DISCORD_BOT_TOKEN || envVars.DISCORD_BOT_TOKEN || '';
  if (!token) {
    logger.warn('Discord: DISCORD_BOT_TOKEN not set');
    return null;
  }
  return new DiscordChannel(token, opts);
});
