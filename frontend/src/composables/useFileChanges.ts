/**
 * 从消息内容中反向解析文件变更记录
 *
 * 遍历 MessageContent.metadata.toolCalls，筛选 write/edit 工具调用，
 * 按 filePath 聚合，用 diffLines 预计算增删行数。
 */
import { computed, type Ref } from "vue";
import { countDiffLines } from "@/utils/diff";
import type { MessageContent } from "@/utils/messageUtils";

export interface FileChangeOperation {
  toolCallId: string;
  toolName: "write" | "edit";
  oldText: string;
  newText: string;
  addedLines: number;
  removedLines: number;
}

export interface FileChangeEntry {
  filePath: string;
  fileName: string;
  operations: FileChangeOperation[];
  totalAdded: number;
  totalRemoved: number;
}

const WRITE_TOOLS = new Set(["write", "edit"]);

function parseArgs(raw: any): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || filePath;
}

export function useFileChanges(turnsCache: Ref<MessageContent[]>) {
  const fileChanges = computed<FileChangeEntry[]>(() => {
    const entries = new Map<string, FileChangeEntry>();

    for (const content of turnsCache.value) {
      const toolCalls = content.metadata?.toolCalls;
      if (!Array.isArray(toolCalls)) continue;

      for (const tc of toolCalls) {
        const name = tc.name;
        if (!name || !WRITE_TOOLS.has(name)) continue;
        if (tc.outcome && tc.outcome !== "success") continue;

        const args = parseArgs(tc.arguments);
        if (!args) continue;

        const filePath: string = args.file_path || args.path || "";
        if (!filePath) continue;

        const toolName = name as "write" | "edit";
        const oldText: string = toolName === "edit" ? (args.old_text ?? "") : "";
        const newText: string =
          toolName === "edit" ? (args.new_text ?? "") : (args.content ?? "");

        const { added, removed } = countDiffLines(oldText, newText);

        const op: FileChangeOperation = {
          toolCallId: tc.id || "",
          toolName,
          oldText,
          newText,
          addedLines: added,
          removedLines: removed,
        };

        let entry = entries.get(filePath);
        if (!entry) {
          entry = {
            filePath,
            fileName: basename(filePath),
            operations: [],
            totalAdded: 0,
            totalRemoved: 0,
          };
          entries.set(filePath, entry);
        }
        entry.operations.push(op);
        entry.totalAdded += added;
        entry.totalRemoved += removed;
      }
    }

    return Array.from(entries.values());
  });

  return { fileChanges };
}
