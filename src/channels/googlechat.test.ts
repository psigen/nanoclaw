import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock googleapis before importing the channel
vi.mock('googleapis', () => {
  const mockCreate = vi.fn().mockResolvedValue({});
  const mockList = vi.fn().mockResolvedValue({ data: { spaces: [] } });
  return {
    google: {
      auth: {
        GoogleAuth: class MockGoogleAuth {},
      },
      options: vi.fn(),
      chat: vi.fn(() => ({
        spaces: {
          messages: { create: mockCreate },
          list: mockList,
        },
      })),
    },
    chat_v1: {},
  };
});

// Mock @google-cloud/pubsub
const mockOn = vi.fn();
vi.mock('@google-cloud/pubsub', () => ({
  PubSub: class MockPubSub {
    subscription() {
      return { on: mockOn };
    }
  },
}));

// Mock env reader to return credentials
vi.mock('../env.js', () => ({
  readEnvFile: vi.fn(() => ({
    GOOGLE_CHAT_SERVICE_ACCOUNT_KEY: '/path/to/key.json',
    GOOGLE_CHAT_PROJECT_ID: 'test-project',
    GOOGLE_CHAT_SUBSCRIPTION_ID: 'test-sub',
  })),
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { getChannelFactory } from './registry.js';

describe('GoogleChatChannel', () => {
  const mockOnMessage = vi.fn();
  const mockOnChatMetadata = vi.fn();
  const mockRegisteredGroups = vi.fn(() => ({}));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers itself in the channel registry', async () => {
    // Import triggers self-registration
    await import('./googlechat.js');
    const factory = getChannelFactory('googlechat');
    expect(factory).toBeDefined();
  });

  it('creates a channel instance when credentials are present', async () => {
    await import('./googlechat.js');
    const factory = getChannelFactory('googlechat')!;
    const channel = factory({
      onMessage: mockOnMessage,
      onChatMetadata: mockOnChatMetadata,
      registeredGroups: mockRegisteredGroups,
    });

    expect(channel).not.toBeNull();
    expect(channel!.name).toBe('googlechat');
  });

  it('ownsJid returns true for gchat: prefix', async () => {
    await import('./googlechat.js');
    const factory = getChannelFactory('googlechat')!;
    const channel = factory({
      onMessage: mockOnMessage,
      onChatMetadata: mockOnChatMetadata,
      registeredGroups: mockRegisteredGroups,
    })!;

    expect(channel.ownsJid('gchat:spaces/AAAA123')).toBe(true);
    expect(channel.ownsJid('tg:123456')).toBe(false);
    expect(channel.ownsJid('slack:C0123')).toBe(false);
  });

  it('connects via Pub/Sub subscription', async () => {
    await import('./googlechat.js');
    const factory = getChannelFactory('googlechat')!;
    const channel = factory({
      onMessage: mockOnMessage,
      onChatMetadata: mockOnChatMetadata,
      registeredGroups: mockRegisteredGroups,
    })!;

    await channel.connect();
    expect(channel.isConnected()).toBe(true);
    expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('disconnects cleanly', async () => {
    await import('./googlechat.js');
    const factory = getChannelFactory('googlechat')!;
    const channel = factory({
      onMessage: mockOnMessage,
      onChatMetadata: mockOnChatMetadata,
      registeredGroups: mockRegisteredGroups,
    })!;

    await channel.connect();
    expect(channel.isConnected()).toBe(true);

    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
  });
});
