/**
 * 持久化层错误类型
 */

/**
 * 会话日志损坏：事件流存在无法安全恢复的缺口（seq 不连续）或历史分卷坏行。
 *
 * 本项目按"整消息"粒度落盘（user/assistant/tool 消息、回合边界事件），
 * 丢失任意一条都是实质性数据丢失，因此 seq 不连续一律拒绝加载（fail-fast），
 * 不做静默截断。区别于可修复的 torn 尾（活跃段末尾 JSON.parse 失败的半条记录）：
 * torn 尾只影响"未完成的残骸"，坏行前 seq 连续即无损，可截断 + 合成 interrupted 回合。
 */
export class CorruptSessionLogError extends Error {
  constructor(
    message: string,
    readonly details?: {
      sessionId?: string;
      file?: string;
      expectedSeq?: number;
      gotSeq?: number;
    },
  ) {
    super(message);
    this.name = "CorruptSessionLogError";
  }
}
