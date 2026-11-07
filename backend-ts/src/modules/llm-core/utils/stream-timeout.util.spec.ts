import { UpstreamTimeoutError } from "./upstream-errors";
import {
  createStreamTimeoutController,
  withStreamIdleTimeout,
  type StreamTimeoutController,
} from "./stream-timeout.util";

/**
 * 流空闲超时包装器契约。
 *
 * 核心场景：openai-node v6 的流迭代器会把 idle 超时触发的 AbortError 吞掉
 * （core/streaming.mjs: `if (isAbortError(e)) return;`），adapter 据此合成
 * 正常 finish——超时被完全吞掉（假成功、无重试、无告警）。wrapper 必须
 * 在流"干净"结束后检查 isIdleTimeout()，扣下尾 chunk（假 finish）并抛
 * UpstreamTimeoutError，让上层重试/超时告警链路照常工作。
 */

const IDLE_MS = 25;

/** 等待 tc.signal abort（或超时保护），返回是否真的发生了 abort */
function waitForAbort(tc: StreamTimeoutController, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    if (tc.signal.aborted) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    tc.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
  });
}

/**
 * 模拟 openai-node v6 的流行为：产出 chunks 后挂起等待；idle 超时 abort 到达时
 * **吞掉错误**并"干净"结束（可选合成一个 finish chunk）。
 */
function makeSwallowingStream(
  chunks: string[],
  tc: StreamTimeoutController,
  options: { syntheticFinish?: boolean } = {},
): AsyncGenerator<string> {
  return (async function* () {
    for (const c of chunks) {
      yield c;
    }
    try {
      await waitForAbort(tc);
    } catch {
      // 吞掉 abort —— openai streaming.mjs 的实际行为
    }
    if (options.syntheticFinish) {
      yield "finish";
    }
  })();
}

/** 消费 wrapper，收集 chunk；返回 { chunks, error } */
async function collect<T>(
  gen: AsyncGenerator<T>,
): Promise<{ chunks: T[]; error: unknown }> {
  const chunks: T[] = [];
  try {
    for await (const c of gen) chunks.push(c);
    return { chunks, error: null };
  } catch (error) {
    return { chunks, error };
  }
}

describe("withStreamIdleTimeout", () => {
  it("SDK 吞掉 idle 超时并合成 finish：假 finish 被扣下，抛 UpstreamTimeoutError", async () => {
    const tc = createStreamTimeoutController(undefined, IDLE_MS);
    const stream = makeSwallowingStream(["a", "b"], tc, { syntheticFinish: true });
    const { chunks, error } = await collect(withStreamIdleTimeout(stream, tc));

    // 缓冲语义：真内容照常转发，只有最后的尾 chunk（此处 = 合成的假 finish）被扣下
    expect(chunks).toEqual(["a", "b"]);
    expect(chunks).not.toContain("finish");
    expect(error).toBeInstanceOf(UpstreamTimeoutError);
  });

  it("SDK 吞掉 idle 超时（无合成 finish，Anthropic 形态）：同样抛超时", async () => {
    const tc = createStreamTimeoutController(undefined, IDLE_MS);
    const stream = makeSwallowingStream(["a", "b"], tc);
    const { chunks, error } = await collect(withStreamIdleTimeout(stream, tc));

    expect(chunks).toEqual(["a"]);
    expect(error).toBeInstanceOf(UpstreamTimeoutError);
  });

  it("无内容挂起（首 token 前超时）：抛 UpstreamTimeoutError", async () => {
    const tc = createStreamTimeoutController(undefined, IDLE_MS);
    const stream = makeSwallowingStream([], tc);
    const { chunks, error } = await collect(withStreamIdleTimeout(stream, tc));

    expect(chunks).toEqual([]);
    expect(error).toBeInstanceOf(UpstreamTimeoutError);
  });

  it("正常完成：chunk 原序转发（含尾 chunk），不抛错", async () => {
    const tc = createStreamTimeoutController(undefined, 5_000);
    const source = (async function* () {
      yield "a";
      yield "b";
      yield "finish";
    })();
    const { chunks, error } = await collect(withStreamIdleTimeout(source, tc));

    expect(error).toBeNull();
    expect(chunks).toEqual(["a", "b", "finish"]);
  });

  it("迭代抛错且为 idle 超时：转换为 UpstreamTimeoutError（既有行为回归）", async () => {
    const tc = createStreamTimeoutController(undefined, IDLE_MS);
    const source = (async function* () {
      yield "a";
      await waitForAbort(tc);
      throw tc.signal.reason;
    })();
    const { chunks, error } = await collect(withStreamIdleTimeout(source, tc));

    expect(chunks).toEqual([]);
    expect(error).toBeInstanceOf(UpstreamTimeoutError);
  });

  it("用户取消（非 idle 超时）：原始 AbortError 原样抛出，不误判为超时", async () => {
    const userController = new AbortController();
    const tc = createStreamTimeoutController(userController.signal, 5_000);
    const abortError = Object.assign(new Error("canceled"), { name: "AbortError" });
    const source = (async function* () {
      yield "a";
      await waitForAbort(tc); // 用户取消到达（无论先后于 listener 注册，均立即返回）
      throw tc.signal.reason ?? abortError;
    })();

    const aborted = waitForAbort(tc);
    queueMicrotask(() => userController.abort(abortError)); // 确定性的立即取消
    const { error } = await collect(withStreamIdleTimeout(source, tc));
    expect(await aborted).toBe(true);

    expect(error).not.toBeInstanceOf(UpstreamTimeoutError);
    expect((error as Error).name).toBe("AbortError");
  });

  it("迭代抛错且与超时无关：原样透传", async () => {
    const tc = createStreamTimeoutController(undefined, 5_000);
    const boom = new Error("provider exploded");
    const source = (async function* () {
      yield "a";
      throw boom;
    })();
    const { error } = await collect(withStreamIdleTimeout(source, tc));

    expect(error).toBe(boom);
  });
});
