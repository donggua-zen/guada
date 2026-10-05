import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";

/** 计划正文长度上限（对齐 ZCode 的 PLAN_MODE_MAX_PLAN_CHARS） */
export const PLAN_MAX_CHARS = 20_000;

/** 会话 id → 文件名安全片段（id 为 ULID/uuid，正常无需替换，仅作防御） */
function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * 计划产物读写（计划模式的持久化载体）。
 *
 * 路径由 workspacePath + sessionId **推导**，不存路径状态字段——少一个状态就少一处不一致。
 * 落在 `<workspace>/.guada/plans/`（与 `.guada/tools_output/` 同族），不污染用户源码目录。
 *
 * 为什么需要落盘：压缩会把头部消息遮蔽，ExitPlanMode 的工具调用可能已被压掉；
 * 计划文件是"计划仍然存在"这件事的稳定来源，压缩后据此重新注入。
 */
@Injectable()
export class PlanFileService {
  private readonly logger = new Logger(PlanFileService.name);

  resolvePlanFilePath(workspacePath: string, sessionId: string): string {
    return path.join(
      workspacePath,
      ".guada",
      "plans",
      `plan-${sanitizeSessionId(sessionId)}.md`,
    );
  }

  /**
   * 原子写入已批准的计划正文。
   *
   * 空白计划直接抛错——不落空文件，否则压缩后的重注入会读到无意义的空壳。
   * 写临时文件再 rename，避免半截内容被下游读到（审批通过即代表计划已定稿）。
   */
  async writeApprovedPlan(input: {
    workspacePath: string;
    sessionId: string;
    plan: string;
  }): Promise<string> {
    const content = input.plan ?? "";
    if (!content.trim()) {
      throw new Error("ExitPlanMode plan cannot be empty");
    }
    if (content.length > PLAN_MAX_CHARS) {
      throw new Error(
        `ExitPlanMode plan exceeds ${PLAN_MAX_CHARS} characters (got ${content.length})`,
      );
    }

    const filePath = this.resolvePlanFilePath(input.workspacePath, input.sessionId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    await fs.writeFile(tmpPath, content, "utf8");
    await fs.rename(tmpPath, filePath);
    this.logger.debug(`Approved plan written: ${filePath} (${content.length} chars)`);
    return filePath;
  }

  /** 读回已批准的计划（不存在返回 null；供压缩后重注入） */
  async readApprovedPlan(input: {
    workspacePath: string;
    sessionId: string;
  }): Promise<{ path: string; content: string } | null> {
    const filePath = this.resolvePlanFilePath(input.workspacePath, input.sessionId);
    try {
      const content = await fs.readFile(filePath, "utf8");
      if (!content.trim()) return null;
      return { path: filePath, content };
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      // 读失败不阻断主流程（重注入是增强项，不是正确性依赖）
      this.logger.warn(`Failed to read approved plan at ${filePath}: ${error?.message}`);
      return null;
    }
  }
}
