import type { Message } from "../../common/types/conversation.types";

/**
 * 标题生成输入：过滤 hidden / 注入的 user 消息后取最后 N 条。
 *
 * 注意助手消息的 `kind` 同样是 `'model'`，不能只按 kind 过滤；
 * 注入消息的判定是 `role === 'user' && kind === 'model'`（或 metadata.hidden）。
 */
export function pickTitleMessages(
  messages: readonly Message[],
  limit = 2,
): Message[] {
  return messages
    .filter((m) => {
      const hidden =
        (m.metadata as Record<string, any> | undefined)?.hidden === true;
      const injectedUser = m.role === "user" && m.kind === "model";
      return !hidden && !injectedUser;
    })
    .slice(-limit);
}
