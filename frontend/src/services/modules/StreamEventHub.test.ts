import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamEventHub, type HubStreamEvent } from "./StreamEventHub";

/**
 * StreamEventHub 全局订阅测试
 *
 * 邮箱已删除（历史读取竞态上移到服务端的 snapshot 通道），这里只覆盖：
 * - subscribeAll / unsubscribe 的实时扇出
 * - 入口幂等游标
 * - 补发缺口标记
 * - cleanup
 */
describe("StreamEventHub 全局订阅", () => {
  let hub: StreamEventHub;

  beforeEach(() => {
    hub = new StreamEventHub();
  });

  function ev(type: string, sessionId: string, baseSeq?: number): HubStreamEvent {
    return { type, sessionId, baseSeq } as HubStreamEvent;
  }

  it("subscribeAll 收到实时事件", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);

    hub.route(ev("text_delta", "s1", 5));
    hub.route(ev("finish", "s1", 6));

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[0][0].type).toBe("text_delta");
    expect(onEvent.mock.calls[1][0].type).toBe("finish");
  });

  it("unsubscribe 后不再接收实时事件", () => {
    const onEvent = vi.fn();
    const off = hub.subscribeAll(onEvent);
    hub.route(ev("text_delta", "s1", 5));
    expect(onEvent).toHaveBeenCalledTimes(1);

    off();
    hub.route(ev("text_delta", "s1", 6));
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});

/**
 * 入口幂等:后端 publish 为每条帧盖戳 (baseSeq=传输基座, chunkSeq) + streamBootId(进程标识)。
 * SSE 重连时连接补发会重放整个 eventBuffer——已路由过的事件必须丢弃,
 * 否则已加载会话的 live 路径会把 delta 重复追加(文本翻倍)。
 */
describe("StreamEventHub 入口幂等((baseSeq, chunkSeq) 元组去重)", () => {
  let hub: StreamEventHub;

  beforeEach(() => {
    hub = new StreamEventHub();
  });

  /** 带传输位置的合成事件 */
  function seqEv(
    type: string,
    sessionId: string,
    baseSeq: number,
    ord: number,
    bootId = "boot1",
  ): HubStreamEvent {
    return {
      type,
      sessionId,
      baseSeq,
      chunkSeq: ord,
      streamBootId: bootId,
    } as HubStreamEvent;
  }

  it("重连补发的重放事件(位置 <= 游标)丢弃,窗口期新到事件保留", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);

    // 首次连接:live (0,1)..(0,3)
    hub.route(seqEv("turn_start", "s1", 0, 1));
    hub.route(seqEv("text_delta", "s1", 0, 2));
    hub.route(seqEv("text_delta", "s1", 0, 3));
    expect(onEvent).toHaveBeenCalledTimes(3);

    // SSE 重连:后端补发重放 buffer (0,1)..(0,3),另含断连窗口期新到的 (0,4)
    hub.route(seqEv("turn_start", "s1", 0, 1));
    hub.route(seqEv("text_delta", "s1", 0, 2));
    hub.route(seqEv("text_delta", "s1", 0, 3));
    hub.route(seqEv("text_delta", "s1", 0, 4));

    // 只有 (0,4) 是新事件
    expect(onEvent).toHaveBeenCalledTimes(4);
    expect(onEvent.mock.calls[3][0].chunkSeq).toBe(4);
  });

  it("全局通知先到不会阻止较旧内容补发，各通道重复投递仍去重", () => {
    const seen: string[] = [];
    hub.subscribeAll((event) => seen.push(event.type));
    hub.route(seqEv("reasoning_delta", "s1", 100, 1));
    hub.route(seqEv("ask_requested", "s1", 102, 1));
    hub.route(seqEv("tool_call_delta", "s1", 100, 2));
    hub.route(seqEv("block_end", "s1", 100, 3));
    hub.route(seqEv("finish", "s1", 101, 1));
    hub.route(seqEv("ask_requested", "s1", 102, 1));
    hub.route(seqEv("tool_call_delta", "s1", 100, 2));
    expect(seen).toEqual([
      "reasoning_delta", "ask_requested", "tool_call_delta", "block_end", "finish",
    ]);
    expect(hub.getCursor("s1")?.baseSeq).toBe(101);
  });

  it("ask_resolved 之后补发旧询问不会复活卡片，内容先到也不吞通知", () => {
    const seen: string[] = [];
    hub.subscribeAll((event) => seen.push(event.type));
    hub.route(seqEv("text_delta", "s1", 110, 1));
    hub.route(seqEv("ask_resolved", "s1", 109, 2));
    hub.route(seqEv("ask_requested", "s1", 109, 1));
    hub.route(seqEv("ask_resolved", "s1", 109, 2));
    expect(seen).toEqual(["text_delta", "ask_resolved"]);
  });

  it.each(["workflow_event", "compression_error"])("%s 不推进内容游标或隐藏内容缺口", (type) => {
    hub.route(seqEv("text_delta", "s1", 5, 1));
    hub.route(seqEv(type, "s1", 20, 1));
    hub.noteCatchupPositions([{ sessionId: "s1", baseSeq: 6, chunkSeq: 1 }]);
    expect(hub.getCursor("s1")?.baseSeq).toBe(5);
    expect(hub.hasPendingGap("s1")).toBe(true);
  });

  it("cleanup 和后端重启分别重置通知去重", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);
    hub.route(seqEv("ask_resolved", "s1", 10, 1));
    hub.route(seqEv("ask_requested", "s1", 1, 1, "boot2"));
    hub.cleanup("s1");
    hub.route(seqEv("ask_requested", "s1", 1, 1, "boot2"));
    expect(onEvent).toHaveBeenCalledTimes(3);
  });

  it("元组边界:同区间递增通过、同元组与低区间丢弃、区间前进接受", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);

    hub.route(seqEv("text_delta", "s1", 3, 1));
    hub.route(seqEv("text_delta", "s1", 3, 2)); // 同区间递增 → 通过
    hub.route(seqEv("text_delta", "s1", 3, 2)); // 同元组 → 丢弃
    hub.route(seqEv("text_delta", "s1", 2, 9)); // 低区间 → 丢弃
    hub.route(seqEv("text_delta", "s1", 4, 1)); // 区间前进,ord 归零 → 通过
    hub.route(seqEv("text_delta", "s1", 4, 1)); // 同元组 → 丢弃

    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(hub.getCursor("s1")).toEqual({
      bootId: "boot1",
      baseSeq: 4,
      chunkSeq: 1,
    });
  });

  it("bootId 变化(后端重启)重置游标:位置归零的新流事件照常接收", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);

    hub.route(seqEv("text_delta", "s1", 0, 5, "boot1"));
    // 后端重启:位置从 (0,1) 重新开始,bootId 不同 → 接受并重置游标
    hub.route(seqEv("turn_start", "s1", 0, 1, "boot2"));
    hub.route(seqEv("text_delta", "s1", 0, 2, "boot2"));
    expect(onEvent).toHaveBeenCalledTimes(3);
    // 重置后在新 bootId 下继续按元组去重
    hub.route(seqEv("turn_start", "s1", 0, 1, "boot2"));
    expect(onEvent).toHaveBeenCalledTimes(3);
  });

  it("缺位置字段的事件放行(fail-open),不影响游标", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);
    const plain = (type: string): HubStreamEvent =>
      ({ type, sessionId: "s1", baseSeq: 1 } as HubStreamEvent); // 无 chunkSeq

    hub.route(plain("text_delta")); // 缺字段 → 放行
    hub.route(seqEv("text_delta", "s1", 1, 1)); // 建立游标
    hub.route(seqEv("text_delta", "s1", 1, 1)); // 重复 → 丢弃
    hub.route(plain("text_delta")); // 缺字段 → 放行
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(hub.getCursor("s1")).toEqual({
      bootId: "boot1",
      baseSeq: 1,
      chunkSeq: 1,
    });
  });

  it("cleanup 一并清掉幂等游标与缺口", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);
    hub.route(seqEv("text_delta", "s1", 5, 1));
    hub.noteCatchupPositions([{ sessionId: "s1", baseSeq: 6, chunkSeq: 1 }]);
    expect(hub.hasPendingGap("s1")).toBe(true);

    hub.cleanup("s1");
    expect(hub.getCursor("s1")).toBeUndefined();
    expect(hub.hasPendingGap("s1")).toBe(false);

    hub.route(seqEv("text_delta", "s1", 3, 1)); // 游标已清 → 接受
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("补发起点越过游标区间 → 标记缺口；同区间跳跃不标记", () => {
    // 无游标 → 不判定
    hub.noteCatchupPositions([{ sessionId: "s1", baseSeq: 5, chunkSeq: 1 }]);
    expect(hub.hasPendingGap("s1")).toBe(false);

    hub.route(seqEv("text_delta", "s1", 3, 2));
    // 同区间内起点更靠后（cleanup 删过 delta）→ 合法空洞,不标记
    hub.noteCatchupPositions([{ sessionId: "s1", baseSeq: 3, chunkSeq: 9 }]);
    expect(hub.hasPendingGap("s1")).toBe(false);
    // 起点落在更晚的落库区间 → 中间可能有本地没收到的事件 → 标记
    hub.noteCatchupPositions([{ sessionId: "s1", baseSeq: 4, chunkSeq: 1 }]);
    expect(hub.hasPendingGap("s1")).toBe(true);

    hub.clearStreamGap("s1");
    expect(hub.hasPendingGap("s1")).toBe(false);
  });
});
