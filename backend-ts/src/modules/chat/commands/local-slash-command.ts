/**
 * 本地斜杠命令解析（对齐 zcode 的"命令在写用户消息前被拦截"语义）
 *
 * 与既有 `[/provider:name ...]` 标签体系的区别：
 * - 标签命令（skill/agent/snip）是**上下文注入**：正文不改写，注入块随消息落库，仍发给模型
 * - 本地命令（如 `/compact`）是**控制指令**：不写用户消息、不进 LLM 历史，由后端直接执行
 *
 * 因此解析必须在"落库/建流"之前完成（ChatController 入口），不能放在 PRE_STEP。
 */

/** 本地命令名（与前端 picker、i18n 共用同一词表） */
export const LOCAL_SLASH_COMMANDS = ['compact', 'compress'] as const;

export type LocalSlashCommandName = (typeof LOCAL_SLASH_COMMANDS)[number];

export interface LocalSlashCommand {
  name: LocalSlashCommandName;
  /** 命令后的自由文本（如 `/compact 只保留最近 10 轮`）——作为摘要附加指令 */
  instructions?: string;
  /** 原始输入（诊断/日志用） */
  raw: string;
}

const COMMAND_RE = /^\s*\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/;

function isLocalCommandName(name: string): name is LocalSlashCommandName {
  const normalized = name.toLowerCase();
  return (LOCAL_SLASH_COMMANDS as readonly string[]).includes(normalized);
}

/**
 * 解析本地斜杠命令。
 *
 * 只有"整段输入就是一条命令"才算命中：`/compact`、`/compact 只保留要点`。
 * 夹在正文中的斜杠（如 `请解释 /compact 是什么意思`、多行消息里的第二行）一律不命中，
 * 避免误吞正常提问。
 *
 * `compress` 作为 `compact` 的别名（zcode 桌面端同样把两者都映射到压缩）。
 *
 * @returns 命中返回命令；非命令（含未知斜杠命令）返回 null —— 未知命令按普通消息处理，
 *          与 zcode 桌面端一致（TUI 的"Unknown command"提示不适用于聊天界面）。
 */
export function parseLocalSlashCommand(
  input: string | undefined | null,
): LocalSlashCommand | null {
  if (typeof input !== 'string') return null;
  const match = COMMAND_RE.exec(input);
  if (!match) return null;
  const [, rawName, rawArgs] = match;
  if (!rawName || !isLocalCommandName(rawName)) return null;
  const instructions = rawArgs?.trim();
  return {
    name: rawName.toLowerCase() as LocalSlashCommandName,
    ...(instructions ? { instructions } : {}),
    raw: input.trim(),
  };
}
