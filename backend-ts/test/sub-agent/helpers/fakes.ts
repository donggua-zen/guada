/**
 * SubAgentManager 的测试替身。
 *
 * SubAgentManager 的 5 个构造依赖全部是接口，所以用手写 fake 直接 new 即可，
 * 不必起 Nest DI —— 与仓库现有主流范式（test/policy/policy-rules.spec.ts）一致。
 *
 * 关键设计：FakeChatRunner.startStream 由 startStreamImpl 脚本化驱动，
 * 测试通过它精确控制「流如何结束」（正常 / 报错 / 永不结束 / startStream 直接失败）。
 */

/** 会话元数据假存储：自动维护每父会话的子代理计数（冻结后递减，与真实语义一致） */
export class FakeSessionMetaStore {
  readonly sessions = new Map<string, any>();
  readonly createCalls: any[] = [];
  readonly updateCalls: Array<{ id: string; patch: any }> = [];
  private counts = new Map<string, number>();
  private seq = 0;

  /** 直接设定某父会话的子代理数（用于测上限） */
  setParentCount(parentId: string, n: number): void {
    this.counts.set(parentId, n);
  }

  countByParentId(parentId: string): number {
    return this.counts.get(parentId) ?? 0;
  }

  async create(input: any): Promise<any> {
    this.createCalls.push(input);
    const id = `sub-${++this.seq}`;
    const session = { id, closedAt: null, ...input };
    this.sessions.set(id, session);
    this.counts.set(input.parentId, (this.counts.get(input.parentId) ?? 0) + 1);
    return session;
  }

  get(id: string): any {
    return this.sessions.get(id);
  }

  async update(id: string, patch: any): Promise<any> {
    this.updateCalls.push({ id, patch });
    const session = this.sessions.get(id);
    if (session) {
      Object.assign(session, patch);
      // 冻结即释放名额
      if (patch.closedAt && !session.__countedReleased) {
        session.__countedReleased = true;
        const n = this.counts.get(session.parentId);
        if (typeof n === "number") this.counts.set(session.parentId, Math.max(0, n - 1));
      }
    }
    return session;
  }

  childrenOf(parentId: string): any[] {
    return [...this.sessions.values()].filter((s) => s.parentId === parentId);
  }

  /** 直接塞一个会话（测 sendMessage / getSubAgents 的既有数据） */
  seed(session: any): any {
    this.sessions.set(session.id, session);
    return session;
  }
}

type StreamCallbacks = {
  onEvent?: (event: any) => void;
  onComplete?: (reason: string) => void;
  onError?: (err: any) => void;
};

export class FakeChatRunner {
  /** 脚本化流行为：驱动 callbacks；返回的 Promise 可永不 settle 以模拟长跑 */
  startStreamImpl?: (params: any, callbacks: StreamCallbacks) => any;
  readonly startStreamCalls: Array<{ params: any; callbacks: StreamCallbacks }> = [];
  readonly activeStreams = new Set<string>();
  readonly cancelCalls: string[] = [];
  readonly enqueued: any[] = [];

  startStream(params: any, callbacks: StreamCallbacks): Promise<void> {
    this.startStreamCalls.push({ params, callbacks });
    this.activeStreams.add(params.sessionId);
    if (!this.startStreamImpl) return Promise.resolve();
    return Promise.resolve(this.startStreamImpl(params, callbacks)).then(() => undefined);
  }

  /** 模拟流自然结束（从活跃集合摘除） */
  finishStream(sessionId: string): void {
    this.activeStreams.delete(sessionId);
  }

  hasActiveStream(sessionId: string): boolean {
    return this.activeStreams.has(sessionId);
  }

  cancelStream(sessionId: string): void {
    this.cancelCalls.push(sessionId);
    this.activeStreams.delete(sessionId);
  }

  async enqueueMessage(msg: any): Promise<void> {
    this.enqueued.push(msg);
  }
}

export class FakeEventBus {
  readonly events: Array<{ event: string; payload: any }> = [];

  emit(event: string, payload: any): void {
    this.events.push({ event, payload });
  }

  of(event: string): any[] {
    return this.events.filter((e) => e.event === event).map((e) => e.payload);
  }
}

export class FakeAgentFileStore {
  readonly agents = new Map<string, any>();

  async findById(id: string): Promise<any> {
    return this.agents.get(id) ?? null;
  }
}

export class FakeMessageStore {
  /** sessionId → 消息数组（供 readSubAgentResult 重放） */
  readonly messages = new Map<string, any[]>();
  loadShouldThrow = false;

  async loadContext(params: { sessionId: string }): Promise<any[]> {
    if (this.loadShouldThrow) throw new Error("JSONL 损坏");
    return this.messages.get(params.sessionId) ?? [];
  }
}

/** 父会话上下文替身（ISessionContext 中 SubAgentManager 实际用到的部分） */
export function createFakeParentContext(overrides: Record<string, any> = {}): any {
  return {
    sessionId: "parent-1",
    workspacePath: "D:/ws",
    getSettings: () => undefined,
    getModelConfig: () => ({ id: "model-1" }),
    getSandboxMode: () => "workspace-write",
    publishStream: async () => undefined,
    ...overrides,
  };
}

/** 造一条 assistant 消息（readSubAgentResult 只认 text / reasoning 块） */
export function assistantMessage(text: string, reasoning?: string): any {
  const content: any[] = [];
  if (text) content.push({ type: "text", text });
  if (reasoning) content.push({ type: "reasoning", summary: reasoning });
  return { role: "assistant", content };
}

/** 让所有已排队的微任务跑完（真实定时器下可用） */
export function flushMicrotasks(times = 3): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) p = p.then(() => Promise.resolve());
  return p;
}
