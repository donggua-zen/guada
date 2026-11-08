/**
 * 本地斜杠命令解析（对齐 zcode 的"命令在写用户消息前被拦截"语义）
 *
 * 与既有 `[/provider:name ...]` 标签体系的区别：
 * - 标签命令（skill/agent/snip）是**上下文注入**：正文不改写，注入块随消息落库，仍发给模型
 * - 本地命令（如 `/compact`）是**控制指令**：不写用户消息、不进 LLM 历史，由后端直接执行
 *
 * 因此解析必须在"落库/建流"之前完成（ChatController 入口），不能放在 PRE_STEP。
 */

/** 内置本地命令名（与前端 picker、i18n 共用同一词表） */
export const LOCAL_SLASH_COMMANDS = ['compact', 'compress', 'goal'] as const;

export type BuiltinLocalSlashCommandName = (typeof LOCAL_SLASH_COMMANDS)[number];

/**
 * 命令名。内置命令之外，v2 插件可通过 registerLocalCommand 注册自己的命令，
 * 因此这里是 string 而不是内置命令的字面量联合。
 */
export type LocalSlashCommandName = string;

export interface LocalSlashCommand {
  name: LocalSlashCommandName;
  /** 命令后的自由文本（如 `/compact 只保留最近 10 轮`）——作为摘要附加指令 */
  instructions?: string;
  /** 原始输入（诊断/日志用） */
  raw: string;
}

const COMMAND_RE = /^\s*\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/;

function isBuiltinCommandName(name: string): boolean {
  return (LOCAL_SLASH_COMMANDS as readonly string[]).includes(name.toLowerCase());
}

/**
 * 解析本地斜杠命令。
 *
 * 只有"整段输入就是一条命令"才算命中：`/compact`、`/compact 只保留要点`。
 * 夹在正文中的斜杠（如 `请解释 /compact 是什么意思`、多行消息里的第二行）一律不命中，
 * 避免误吞正常提问。
 *
 * @param isKnown 命令是否已注册（默认只认内置词表；ChatController 传入
 *                LocalSlashCommandRegistry.has 以支持插件命令）
 */
export function parseLocalSlashCommand(
  input: string | undefined | null,
  isKnown?: (name: string) => boolean,
): LocalSlashCommand | null {
  if (typeof input !== 'string') return null;
  const match = COMMAND_RE.exec(input);
  if (!match) return null;
  const [, rawName, rawArgs] = match;
  if (!rawName) return null;
  const name = rawName.toLowerCase();
  const known = isKnown ? isKnown(name) : isBuiltinCommandName(name);
  if (!known) return null;
  const instructions = rawArgs?.trim();
  return {
    name,
    ...(instructions ? { instructions } : {}),
    raw: input.trim(),
  };
}
