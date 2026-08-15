/**
 * 创建一个 name=AbortError 的标准中止错误。
 *
 * 各层代码（AgentEngine / classifyError / runAgentEngine）都依赖
 * `error.name === "AbortError"` 来识别用户手动中止，不能直接 `new Error("AbortError")`
 * （那样 name 会是 "Error"，导致中止被误判为真实错误或触发不必要的重试）。
 */
export function createAbortError(message = "Request aborted"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}
