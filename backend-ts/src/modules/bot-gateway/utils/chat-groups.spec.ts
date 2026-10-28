import {
  buildChatGroups,
  cleanSessionTitle,
  stripClearedSuffix,
  type ChatBotMeta,
  type ChatGroupSession,
} from './chat-groups';

const bots: ChatBotMeta[] = [
  {
    id: 'bot-1',
    name: '机器人一',
    platform: 'qq',
    enabled: true,
    status: 'running',
    runtimeStatus: 'connected',
    online: true,
  },
  {
    id: 'bot-2',
    name: '机器人二',
    platform: 'lark',
    enabled: false,
    status: 'stopped',
    runtimeStatus: null,
    online: false,
  },
  {
    id: 'bot-3',
    name: '无会话机器人',
    platform: 'discord',
    enabled: true,
    status: 'running',
    runtimeStatus: 'connected',
    online: true,
  },
];

const sessions: ChatGroupSession[] = [
  {
    id: 's1',
    botId: 'bot-1',
    platform: 'qq',
    externalId: 'qq:private:user-a',
    title: 'QQ 私聊 user-a',
    lastActiveAt: '2026-01-01T10:00:00.000Z',
    data: { botUser: { name: '张三' } },
  },
  {
    id: 's2',
    botId: 'bot-1',
    platform: 'qq',
    externalId: 'qq:private:user-a@1700000000000',
    title: 'QQ 私聊 user-a (已清空)',
    lastActiveAt: '2026-01-02T10:00:00.000Z',
    data: null,
  },
  {
    id: 's3',
    botId: 'bot-1',
    platform: 'qq',
    externalId: 'qq:group:group-1',
    title: 'QQ 群聊 group-1',
    lastActiveAt: '2026-01-03T10:00:00.000Z',
    data: null,
  },
  {
    id: 's4',
    botId: 'bot-x',
    platform: 'qq',
    externalId: 'qq:private:user-z',
    title: 'QQ 私聊 user-z',
    lastActiveAt: '2026-01-04T10:00:00.000Z',
    data: null,
  },
  {
    id: 's5',
    botId: 'bot-2',
    platform: 'lark',
    externalId: 'lark:private:user-b',
    title: 'LARK 私聊 user-b',
    lastActiveAt: '2026-01-05T10:00:00.000Z',
    data: null,
  },
];

describe('buildChatGroups', () => {
  it('aggregates reset-marker sessions into one user row', () => {
    const groups = buildChatGroups(sessions, bots);
    const bot1 = groups.find((group) => group.botId === 'bot-1')!;
    const userA = bot1.conversations.find(
      (conversation) => conversation.nativeId === 'user-a',
    )!;

    expect(userA.sessionCount).toBe(2);
    expect(userA.sessionId).toBe('s2');
    expect(userA.sessions.map((session) => session.id)).toEqual(['s2', 's1']);
    expect(userA.sessions[0].cleared).toBe(true);
    expect(userA.sessions[1].cleared).toBe(false);
    expect(userA.cleared).toBe(true);
    expect(userA.displayName).toBe('张三');
    expect(userA.sourceType).toBe('private');
  });

  it('falls back to the latest cleaned title when no nickname exists', () => {
    const groups = buildChatGroups(sessions, bots);
    const bot1 = groups.find((group) => group.botId === 'bot-1')!;
    const groupChat = bot1.conversations.find(
      (conversation) => conversation.sourceType === 'group',
    )!;

    expect(groupChat.displayName).toBe('group-1');
    expect(groupChat.nativeId).toBe('group-1');
  });

  it('keeps bots without sessions and puts unknown bots last', () => {
    const groups = buildChatGroups(sessions, bots);

    expect(groups.map((group) => group.botId)).toEqual([
      'bot-2',
      'bot-1',
      'bot-3',
      'bot-x',
    ]);
    expect(groups.find((group) => group.botId === 'bot-3')!.conversations).toHaveLength(0);
    expect(groups.find((group) => group.botId === 'bot-x')!.unknownBot).toBe(true);
    expect(groups.find((group) => group.botId === 'bot-x')!.name).toBe('未知机器人');
  });

  it('sorts conversations by latest activity and applies per-bot limits', () => {
    const groups = buildChatGroups(sessions, bots, 1);
    const bot1 = groups.find((group) => group.botId === 'bot-1')!;

    expect(bot1.total).toBe(2);
    expect(bot1.hasMore).toBe(true);
    expect(bot1.conversations).toHaveLength(1);
    expect(bot1.conversations[0].nativeId).toBe('group-1');
  });

  it('honours manual sortOrder over activity bubbling', () => {
    // bot-3 没有会话，按活跃规则本该排最后；sortOrder=0 应把它顶到最前
    const orderedBots: ChatBotMeta[] = bots.map((bot) => ({
      ...bot,
      sortOrder: bot.id === 'bot-3' ? 0 : bot.id === 'bot-1' ? 1 : 2,
    }));
    const groups = buildChatGroups(sessions, orderedBots);

    expect(groups.map((group) => group.botId)).toEqual([
      'bot-3',
      'bot-1',
      'bot-2',
      'bot-x',
    ]);
  });

  it('keeps pinned conversations on top regardless of activity', () => {
    // s1 属于 user-a（活跃时间比 group-1 旧），置顶后应压过 group-1
    const pinned: ChatGroupSession[] = sessions.map((session) =>
      session.id === 's1' ? { ...session, pinned: true } : session,
    );
    const bot1 = buildChatGroups(pinned, bots).find((group) => group.botId === 'bot-1')!;

    expect(bot1.conversations.map((c) => c.nativeId)).toEqual(['user-a', 'group-1']);
    expect(bot1.conversations[0].pinned).toBe(true);
    expect(bot1.conversations[1].pinned).toBe(false);
  });

  it('returns all conversations when the limit is non-positive', () => {
    const groups = buildChatGroups(sessions, bots, 0);
    const bot1 = groups.find((group) => group.botId === 'bot-1')!;

    expect(bot1.conversations).toHaveLength(2);
    expect(bot1.hasMore).toBe(false);
  });

  it('handles sessions without externalId as their own conversation', () => {
    const groups = buildChatGroups(
      [
        {
          id: 's6',
          botId: 'bot-1',
          platform: 'qq',
          externalId: null,
          title: 'Legacy',
          lastActiveAt: '2026-01-06T10:00:00.000Z',
          data: null,
        },
      ],
      bots,
    );
    const bot1 = groups.find((group) => group.botId === 'bot-1')!;

    expect(bot1.conversations).toHaveLength(1);
    expect(bot1.conversations[0].sessionId).toBe('s6');
    expect(bot1.conversations[0].externalId).toBe('s6');
    expect(bot1.conversations[0].sourceType).toBeNull();
  });
  it('carries the first available bot user avatar', () => {
    const groups = buildChatGroups(
      [
        {
          id: 's-avatar',
          botId: 'bot-1',
          platform: 'discord',
          externalId: 'discord:private:user-avatar',
          title: 'DISCORD 私聊 user-avatar',
          lastActiveAt: '2026-01-07T10:00:00.000Z',
          data: {
            botUser: {
              name: 'Alice',
              avatarUrl: 'https://cdn.example/avatar.png',
            },
          },
        },
      ],
      bots,
    );
    const conversation = groups
      .find((group) => group.botId === 'bot-1')!
      .conversations.find((item) => item.nativeId === 'user-avatar')!;

    expect(conversation.displayName).toBe('Alice');
    expect(conversation.avatarUrl).toBe('https://cdn.example/avatar.png');
  });

  it('ignores placeholder nicknames and falls back to the cleaned title', () => {
    const groups = buildChatGroups(
      [
        {
          id: 's-placeholder',
          botId: 'bot-1',
          platform: 'wechat-personal',
          externalId: 'wechat-personal:private:o9abc@im.wechat',
          title: 'WECHAT-PERSONAL 私聊 o9abc',
          lastActiveAt: '2026-01-08T10:00:00.000Z',
          data: { botUser: { name: '用户' } },
        },
      ],
      bots,
    );
    const conversation = groups
      .find((group) => group.botId === 'bot-1')!
      .conversations.find((item) => item.nativeId?.includes('o9abc'))!;

    expect(conversation.displayName).toBe('o9abc');
    expect(conversation.nativeId).toBe('o9abc@im.wechat');
    expect(conversation.avatarUrl).toBeNull();
  });
});

describe('stripClearedSuffix', () => {
  it('removes the clear_session suffix', () => {
    expect(stripClearedSuffix('QQ 私聊 user-a (已清空)')).toBe('QQ 私聊 user-a');
    expect(stripClearedSuffix('  (已清空)  ')).toBe('');
    expect(stripClearedSuffix(null)).toBe('');
  });
});

describe('cleanSessionTitle', () => {
  it('removes platform/type prefixes and the cleared suffix', () => {
    expect(cleanSessionTitle('WECOM 私聊 ZhenDong')).toBe('ZhenDong');
    expect(cleanSessionTitle('WECHAT-PERSONAL 私聊 o9cq80zR')).toBe('o9cq80zR');
    expect(cleanSessionTitle('QQ 群聊 53790ECD (已清空)')).toBe('53790ECD');
    expect(cleanSessionTitle('Legacy')).toBe('Legacy');
    expect(cleanSessionTitle(null)).toBe('');
  });
});
