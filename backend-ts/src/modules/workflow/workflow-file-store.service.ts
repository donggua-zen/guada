/**
 * Workflow 终态快照文件存储（会话伴生存储，零 DB）
 *
 * 布局：<sessions根>/<sessionId>/workflows/<runId>.json——与会话 JSONL 同目录：
 * - 归类清晰：run 归档属于会话产物，审计时与会话数据同目录对照
 * - 删除免费：会话删除/清空经 jsonl-backend.deleteSession 整目录 rm -rf，
 *   workflows/ 随之级联清理，无需任何额外删除代码
 *
 * 与方案 B 的关系：运行中 run 仍是内存快照 + SSE（不落盘）；仅 settle() 终态
 * 一次性原子写（temp + rename），不进对话事件流、不占 seq、无追加无锁。
 */
import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs/promises";
import { resolveSessionsBasePath } from "../../common/utils/session-path.util";
import { WorkflowRunSnapshot } from "./workflow.types";

/** runId 文件名白名单（引擎生成 wfr_<ts>_<rand>；防未来格式变化引入路径穿越） */
const RUN_ID_RE = /^[A-Za-z0-9_-]+$/;

@Injectable()
export class WorkflowFileStore {
  private readonly logger = new Logger(WorkflowFileStore.name);

  private runDir(sessionId: string): string {
    return path.join(resolveSessionsBasePath(), sessionId, "workflows");
  }

  /** 终态快照落盘（原子写；调用方 fire-and-forget，失败仅告警不影响 run） */
  async saveRunSnapshot(
    sessionId: string,
    snapshot: WorkflowRunSnapshot,
  ): Promise<void> {
    if (!RUN_ID_RE.test(snapshot.runId)) {
      throw new Error(`invalid workflow runId: ${snapshot.runId}`);
    }
    const dir = this.runDir(sessionId);
    await fs.mkdir(dir, { recursive: true });
    const finalPath = path.join(dir, `${snapshot.runId}.json`);
    const tmpPath = `${finalPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(snapshot), "utf-8");
    await fs.rename(tmpPath, finalPath);
  }

  /** 读取会话全部历史 run 快照（目录不存在返回 []，单文件损坏跳过并告警） */
  async listRunSnapshots(sessionId: string): Promise<WorkflowRunSnapshot[]> {
    const dir = this.runDir(sessionId);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: WorkflowRunSnapshot[] = [];
    for (const file of files.sort()) {
      if (!file.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(
          await fs.readFile(path.join(dir, file), "utf-8"),
        ) as WorkflowRunSnapshot;
        if (parsed && typeof parsed.runId === "string") {
          out.push(parsed);
        }
      } catch (err) {
        this.logger.warn(
          `跳过损坏的 workflow 快照 ${sessionId}/${file}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return out;
  }
}
