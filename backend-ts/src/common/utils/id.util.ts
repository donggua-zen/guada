/**
 * 全局唯一 id 铸造入口（单一真相）
 *
 * 全项目 id 只允许两种形态，均从本模块铸造：
 *
 * 1. 实体域：`<语义前缀> + UUID v4`（mintId）
 *    - 用于目录/文件名与跨文档外键：session- / agent- / bot- / mcp- / kb- / kbf- /
 *      grp-（会话分组）/ task-（定时任务）/ tasklog-（任务执行日志）/ conn-（远程连接）/
 *      id-（JSONL 内通用 id：contentId / attachmentId）/ proc-（进程句柄兜底）
 *    - 前缀不参与任何运行时类型判定（全代码库无 startsWith 反推），价值在人眼排障：
 *      bots/*.yaml 等同文档混排多个域的外键时，断链一眼可辨
 * 2. 消息域：`m_<ULID>` / `c_<ULID>`（mintOrderedId）
 *    - 字典序 = 时间序（同毫秒单调递增、时钟回拨钳制），压缩遮蔽区间
 *      [startId, endId] 与 'c' < 'm' 检查点前序全依赖此性质，禁止改成 UUID
 *
 * 哨兵/派生标记（prune_<seq>、__compact_<seq>、__summary_* 占位）不是随机铸造
 * 的 id，不走本模块；LLM 线上字段（toolCallId `call_*`）沿用 provider 约定。
 *
 * 存量 id（cuid、旧 m_<ts>_<rand>、msg_*、__compact_*）不迁移：
 * parseOrderedId 对旧格式返回 null 已天然兼容，引用零改写。
 */
import { randomUUID } from "crypto";
import { generateOrderedMessageId } from "./ordered-id.util";

/** 语义前缀表：新增实体域时在此登记，禁止在 store 内散落字面量 */
export const ID_PREFIXES = {
  session: "session-",
  agent: "agent-",
  bot: "bot-",
  mcp: "mcp-",
  kb: "kb-",
  kbFile: "kbf-",
  group: "grp-",
  task: "task-",
  taskLog: "tasklog-",
  conn: "conn-",
  id: "id-",
  proc: "proc-",
} as const;

/** 铸造实体 id：`<prefix> + UUID v4`（原 file-store-kit 实现，此处为唯一实现） */
export function mintId(prefix = ""): string {
  return `${prefix}${randomUUID()}`;
}

/** 铸造消息域有序 id：m_<ULID>（普通消息）/ c_<ULID>（压缩检查点） */
export function mintOrderedId(kind: "m" | "c" = "m"): string {
  return generateOrderedMessageId(kind);
}
