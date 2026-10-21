/**
 * 本地斜杠命令解析（与后端 backend-ts/src/modules/chat/commands/local-slash-command.ts 同规则）
 *
 * 只有"整段输入就是一条本地命令"才算命中，夹在正文中的 `/` 一律不算，
 * 避免把正常提问/路径误判成命令。
 */

export const LOCAL_SLASH_COMMAND_NAMES = ['compact', 'compress'] as const;

export type LocalSlashCommandName = (typeof LOCAL_SLASH_COMMAND_NAMES)[number];

export interface LocalSlashCommand {
  name: LocalSlashCommandName;
  /** 命令后的自由文本（`/compact 只保留最近 10 轮`），作为摘要附加指令 */
  instructions?: string;
}

const COMMAND_RE = /^\s*\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/;

/** 解析本地斜杠命令；非本地命令（含未知斜杠命令）返回 null。 */
export function parseLocalSlashCommand(
  input: string | undefined | null,
): LocalSlashCommand | null {
  if (typeof input !== 'string') return null;
  const match = COMMAND_RE.exec(input);
  if (!match) return null;
  const [, rawName, rawArgs] = match;
  if (!rawName) return null;
  const name = rawName.toLowerCase();
  if (!(LOCAL_SLASH_COMMAND_NAMES as readonly string[]).includes(name)) {
    return null;
  }
  const instructions = rawArgs?.trim();
  return {
    name: name as LocalSlashCommandName,
    ...(instructions ? { instructions } : {}),
  };
}
