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
describe("StreamEventHub 邮箱 + 全局订阅", () => {
  let hub: StreamEventHub;

  beforeEach(() => {
    hub = new StreamEventHub();
  });

  function ev(type: string, sessionId: string, prevSeq?: number): HubStreamEvent {
    return { type, sessionId, prevSeq } as HubStreamEvent;
  }

  it("route 无订阅者也进邮箱（供强制重拉取尾部）", () => {
    hub.route(ev("turn_start", "s1", 1));
    hub.route(ev("text_delta", "s1", 2));
    expect(hub.getMailboxSize("s1")).toBe(2);
    expect(hub.getMailboxSize("unknown")).toBe(0);
  });

  it("subscribeAll 收到实时事件", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);

    hub.route(ev("text_delta", "s1", 5));
    hub.route(ev("finish", "s1", 6));

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[0][0].type).toBe("text_delta");
    expect(onEvent.mock.calls[1][0].type).toBe("finish");
  });

  it("unsubscribe 后不再接收实时事件（但事件仍进邮箱）", () => {
    const onEvent = vi.fn();
    const off = hub.subscribeAll(onEvent);
    hub.route(ev("text_delta", "s1", 5));
    expect(onEvent).toHaveBeenCalledTimes(1);

    off();
    hub.route(ev("text_delta", "s1", 6));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(hub.getMailboxSize("s1")).toBe(2);
  });

  it("邮箱滚动上限:超过 MAX_BUFFERED 丢最旧", () => {
    for (let i = 1; i <= 2001; i++) {
      hub.route(ev("text_delta", "s1", i));
    }
    expect(hub.getMailboxSize("s1")).toBe(2000);
  });

  it("不同会话的邮箱互不干扰", () => {
    hub.route(ev("text_delta", "s1", 2));
    expect(hub.getMailboxSize("s1")).toBe(1);
    expect(hub.getMailboxSize("s2")).toBe(0);
  });
});

/**
 * 强制重拉用的"在飞尾部"：最后一个 checkpoint（finish/turn_end）之后的 chunk。
 * 与整页刷新等价：事件页只含已落盘内容，尾部靠邮箱重放（delta 不进 eventLog）。
 */
describe("StreamEventHub 在飞尾部(getTailAfterLastCheckpoint)", () => {
  let hub: StreamEventHub;

  beforeEach(() => {
    hub = new StreamEventHub();
  });

  function ev(type: string, sessionId: string, prevSeq?: number): HubStreamEvent {
    return { type, sessionId, prevSeq } as HubStreamEvent;
  }

  it("取最后一个 finish 之后的 chunk（含未落盘的 delta）", () => {
    hub.route(ev("turn_start", "s1", 1));
    hub.route(ev("text_delta", "s1", 1));
    hub.route(ev("block_end", "s1", 1));
    hub.route(ev("finish", "s1", 2));
    hub.route(ev("text_delta", "s1", 2));
    hub.route(ev("reasoning_delta", "s1", 2));

    expect(hub.getTailAfterLastCheckpoint("s1").map((e) => e.type)).toEqual([
      "text_delta",
      "reasoning_delta",
    ]);
  });

  it("turn_end 也作为 checkpoint：下一回合的未落盘事件才是尾部", () => {
    hub.route(ev("turn_start", "s1", 4));
    hub.route(ev("turn_end", "s1", 5));
    hub.route(ev("turn_start", "s1", 6));
    hub.route(ev("user_message", "s1", 6));
    hub.route(ev("text_delta", "s1", 6));

    expect(hub.getTailAfterLastCheckpoint("s1").map((e) => e.type)).toEqual([
      "turn_start",
      "user_message",
      "text_delta",
    ]);
  });

  it("checkpoint 之后无事件时返回空（回合刚结束/已全部落盘）", () => {
    hub.route(ev("turn_start", "s1", 1));
    hub.route(ev("turn_end", "s1", 2));
    expect(hub.getTailAfterLastCheckpoint("s1")).toEqual([]);
  });

  it("没有 checkpoint（邮箱已滚出/从未收到流）返回空：放弃尾部", () => {
    hub.route(ev("text_delta", "s1", 1));
    hub.route(ev("text_delta", "s1", 2));
    expect(hub.getTailAfterLastCheckpoint("s1")).toEqual([]);
    expect(hub.getTailAfterLastCheckpoint("unknown")).toEqual([]);
  });

  it("只读：不推进去重游标、不清邮箱", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);
    const seqEv = (type: string, ord: number): HubStreamEvent =>
      ({ type, sessionId: "s1", prevSeq: 1, chunkSeq: ord, streamBootId: "boot1" } as HubStreamEvent);

    hub.route(seqEv("turn_end", 1)); // checkpoint（已落盘边界）
    hub.route(seqEv("turn_start", 2));
    hub.route(seqEv("text_delta", 3));
    expect(hub.getTailAfterLastCheckpoint("s1").map((e) => e.type)).toEqual([
      "turn_start",
      "text_delta",
    ]);

    // 读取尾部后重放同一批事件仍被去重；邮箱内容不变
    hub.route(seqEv("turn_end", 1));
    hub.route(seqEv("turn_start", 2));
    hub.route(seqEv("text_delta", 3));
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(hub.getTailAfterLastCheckpoint("s1").map((e) => e.type)).toEqual([
      "turn_start",
      "text_delta",
    ]);
  });
});

/**
 * 入口幂等:后端 publish 为每条帧盖戳 (prevSeq, chunkSeq) + streamBootId(进程标识)。
 * SSE 重连时连接补发会重放整个 eventBuffer——已路由过的事件必须丢弃,
 * 否则已加载会话的 live 路径会把 delta 重复追加(文本翻倍)。
 */
describe("StreamEventHub 入口幂等((prevSeq, chunkSeq) 元组去重)", () => {
  let hub: StreamEventHub;

  beforeEach(() => {
    hub = new StreamEventHub();
  });

  /** 带传输位置的合成事件 */
  function seqEv(
    type: string,
    sessionId: string,
    logSeq: number,
    ord: number,
    bootId = "boot1",
  ): HubStreamEvent {
    return {
      type,
      sessionId,
      prevSeq: logSeq,
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
    // 邮箱无重复
    expect(hub.getMailboxSize("s1")).toBe(4);
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
      prevSeq: 4,
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
      ({ type, sessionId: "s1", prevSeq: 1 } as HubStreamEvent); // 无 chunkSeq

    hub.route(plain("text_delta")); // 缺字段 → 放行
    hub.route(seqEv("text_delta", "s1", 1, 1)); // 建立游标
    hub.route(seqEv("text_delta", "s1", 1, 1)); // 重复 → 丢弃
    hub.route(plain("text_delta")); // 缺字段 → 放行
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(hub.getCursor("s1")).toEqual({
      bootId: "boot1",
      prevSeq: 1,
      chunkSeq: 1,
    });
  });

  it("cleanup 一并清掉幂等游标与缺口", () => {
    const onEvent = vi.fn();
    hub.subscribeAll(onEvent);
    hub.route(seqEv("text_delta", "s1", 5, 1));
    hub.noteCatchupPositions([{ sessionId: "s1", prevSeq: 6, chunkSeq: 1 }]);
    expect(hub.hasPendingGap("s1")).toBe(true);

    hub.cleanup("s1");
    expect(hub.getMailboxSize("s1")).toBe(0);
    expect(hub.getCursor("s1")).toBeUndefined();
    expect(hub.hasPendingGap("s1")).toBe(false);

    hub.route(seqEv("text_delta", "s1", 3, 1)); // 游标已清 → 接受
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("补发起点越过游标区间 → 标记缺口；同区间跳跃不标记", () => {
    // 无游标 → 不判定
    hub.noteCatchupPositions([{ sessionId: "s1", prevSeq: 5, chunkSeq: 1 }]);
    expect(hub.hasPendingGap("s1")).toBe(false);

    hub.route(seqEv("text_delta", "s1", 3, 2));
    // 同区间内起点更靠后（cleanup 删过 delta）→ 合法空洞,不标记
    hub.noteCatchupPositions([{ sessionId: "s1", prevSeq: 3, chunkSeq: 9 }]);
    expect(hub.hasPendingGap("s1")).toBe(false);
    // 起点落在更晚的落库区间 → 中间可能有本地没收到的事件 → 标记
    hub.noteCatchupPositions([{ sessionId: "s1", prevSeq: 4, chunkSeq: 1 }]);
    expect(hub.hasPendingGap("s1")).toBe(true);

    hub.clearStreamGap("s1");
    expect(hub.hasPendingGap("s1")).toBe(false);
  });
});
