import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamEventHub, type HubStreamEvent } from "./StreamEventHub";

/**
 * StreamEventHub 邮箱 + 订阅测试
 *
 * 覆盖"打开正在流会话/刷新续传"的竞态核心:
 * - route 无订阅者时事件进邮箱不丢(供打开会话后订阅取增量)
 * - subscribe(lastSeq) 按 prevSeq >= lastSeq 精确切增量(历史之后发生的)
 * - lastSeq = null(无历史)取全部带 prevSeq 的事件
 * - 订阅建立后的实时事件推给 onEvent
 * - unsubscribe 后不再接收实时事件
 * - 邮箱滚动上限(MAX_BUFFERED = 2000)
 */
describe("StreamEventHub 邮箱 + 订阅", () => {
  let hub: StreamEventHub;

  beforeEach(() => {
    hub = new StreamEventHub();
  });

  /**
   * 合成测试事件:HubStreamEvent 现为共享判别联合(WireStreamEvent),
   * 邮箱机制测试不关心协议载荷,直接断言转型构造。
   */
  function ev(type: string, sessionId: string, prevSeq?: number): HubStreamEvent {
    return { type, sessionId, prevSeq } as HubStreamEvent;
  }

  it("route 无订阅者时事件进邮箱,打开会话后 subscribe 可取到增量", () => {
    // 模拟:其他窗口/刷新前事件已通过 SSE 到达,本窗口未打开该会话
    // 真实时序:turn/start(seq=1)、user/message(seq=2)均已入库,lastSeq=2
    hub.route(ev("turn_start", "s1", 1));   // prevSeq=1 < lastSeq,已在历史,不补
    hub.route(ev("text_delta", "s1", 2));         // prevSeq=2 >= lastSeq,补
    hub.route(ev("text_delta", "s1", 2));         // 同一区间多个 chunk 共享 prevSeq

    // 打开会话:loadSession 得 lastSeq=2(历史快照到 user/message)
    const { initialEvents } = hub.subscribe("s1", 2, () => {});
    // prevSeq >= 2 的增量 = seq2 区间(全补,不区分内部顺序);turn_start 已含于历史不补
    expect(initialEvents.map((e) => e.type)).toEqual(["text_delta", "text_delta"]);
  });

  it("prevSeq < lastSeq 的已入库事件不进增量(历史已含,不重复)", () => {
    hub.route(ev("turn_start", "s1", 1));
    hub.route(ev("user_message", "s1", 2));
    hub.route(ev("reasoning_delta", "s1", 2));
    hub.route(ev("text_delta", "s1", 2));

    // 历史快照已到 seq=3(回合已 finish,chunk 合并入库)
    const { initialEvents } = hub.subscribe("s1", 3, () => {});
    expect(initialEvents).toEqual([]);
  });

  it("lastSeq=null(无历史)取全部带 prevSeq 的事件", () => {
    hub.route(ev("turn_start", "s1", 1));
    hub.route(ev("text_delta", "s1", 2));
    const { initialEvents } = hub.subscribe("s1", null, () => {});
    expect(initialEvents.map((e) => e.type)).toEqual(["turn_start", "text_delta"]);
  });

  it("无 prevSeq 的事件不进增量(非流内/无游标事件)", () => {
    hub.route(ev("orphan", "s1", undefined));
    const { initialEvents } = hub.subscribe("s1", 0, () => {});
    expect(initialEvents).toEqual([]);
  });

  it("订阅建立后的实时事件推给 onEvent", () => {
    const onEvent = vi.fn();
    hub.subscribe("s1", null, onEvent);

    hub.route(ev("text_delta", "s1", 5));
    hub.route(ev("finish", "s1", 6));

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[0][0].type).toBe("text_delta");
    expect(onEvent.mock.calls[1][0].type).toBe("finish");
  });

  it("unsubscribe 后不再接收实时事件(但事件仍进邮箱)", () => {
    const onEvent = vi.fn();
    const { unsubscribe } = hub.subscribe("s1", null, onEvent);
    hub.route(ev("text_delta", "s1", 5));
    expect(onEvent).toHaveBeenCalledTimes(1);

    unsubscribe();
    hub.route(ev("text_delta", "s1", 6));
    expect(onEvent).toHaveBeenCalledTimes(1);

    // 事件仍进邮箱:新订阅者能取到
    const { initialEvents } = hub.subscribe("s1", null, () => {});
    expect(initialEvents.length).toBe(2);
  });

  it("初始订阅时返回的增量 + 之后实时事件不重复", () => {
    const onEvent = vi.fn();
    hub.route(ev("text_delta", "s1", 2)); // 订阅前已到
    const { initialEvents, unsubscribe } = hub.subscribe("s1", 2, onEvent);
    expect(initialEvents.map((e) => e.type)).toEqual(["text_delta"]);

    hub.route(ev("finish", "s1", 3)); // 订阅后实时
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].type).toBe("finish");
    unsubscribe();
  });

  it("邮箱滚动上限:超过 MAX_BUFFERED 丢最旧", () => {
    // 塞满 2000+1 条,最旧一条被挤出
    for (let i = 1; i <= 2001; i++) {
      hub.route(ev("text_delta", "s1", i));
    }
    const { initialEvents } = hub.subscribe("s1", null, () => {});
    expect(initialEvents.length).toBe(2000);
    // 最旧的 seq=1 被挤出,从 seq=2 开始
    expect(initialEvents[0].prevSeq).toBe(2);
  });

  it("不同会话的邮箱互不干扰", () => {
    hub.route(ev("text_delta", "s1", 2));
    const { initialEvents: s1 } = hub.subscribe("s1", 2, () => {});
    const { initialEvents: s2 } = hub.subscribe("s2", 2, () => {});
    expect(s1.length).toBe(1);
    expect(s2.length).toBe(0);
  });

  it("cleanup 清空会话状态", () => {
    hub.route(ev("text_delta", "s1", 2));
    hub.cleanup("s1");
    const { initialEvents } = hub.subscribe("s1", null, () => {});
    expect(initialEvents).toEqual([]);
  });
});
