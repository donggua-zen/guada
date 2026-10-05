import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";

/** 计划正文长度上限（对齐 ZCode 的 PLAN_MODE_MAX_PLAN_CHARS） */
export const PLAN_MAX_CHARS = 20_000;

/** 路径段净化（会话 id / 计划 id 共用；id 为 ULID/uuid/toolCallId，正常无需替换，仅作防御） */
function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * 计划产物读写（计划模式的持久化载体）。
 *
 * 路径：`<workspace>/.guada/plans/<sessionId>/<planId>.md` —— **每份计划一个文件**，
 * 不再会话级整文件覆盖；planId = ExitPlanMode 的 toolCallId（计划身份与转录对齐，
 * 历史列表由 PlanHistoryService 扫转录构建，文件是"文件树可见 + 压缩后重注入"的落盘副本）。
 *
 * 路径由 workspacePath + sessionId + planId **推导**，不存路径状态字段——少一个状态就少一处不一致。
 * 落在 `.guada/` 下（与 `.guada/tools_output/` 同族），不污染用户源码目录。
 */
@Injectable()
export class PlanFileService {
  private readonly logger = new Logger(PlanFileService.name);

  resolvePlanFilePath(
    workspacePath: string,
    sessionId: string,
    planId: string,
  ): string {
    return path.join(
      workspacePath,
      ".guada",
      "plans",
      sanitizeSegment(sessionId),
      `${sanitizeSegment(planId)}.md`,
    );
  }

  /** 工作区相对路径（前端打开文件用；绝对路径会被工作区接口的路径牢笼拒绝） */
  resolveRelativePlanPath(
    workspacePath: string,
    sessionId: string,
    planId: string,
  ): string {
    return path
      .relative(
        workspacePath,
        this.resolvePlanFilePath(workspacePath, sessionId, planId),
      )
      .split(path.sep)
      .join("/");
  }

  /** 计划文件是否已落盘（未落盘的计划仍可由转录提供列表项） */
  async planFileExists(
    workspacePath: string,
    sessionId: string,
    planId: string,
  ): Promise<boolean> {
    try {
      await fs.access(this.resolvePlanFilePath(workspacePath, sessionId, planId));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 原子写入一份计划正文。
   *
   * 空白计划直接抛错——不落空文件，否则压缩后的重注入会读到无意义的空壳。
   * 写临时文件再 rename，避免半截内容被下游读到（计划落盘即代表该次 ExitPlanMode 已定稿）。
   */
  async writeApprovedPlan(input: {
    workspacePath: string;
    sessionId: string;
    planId: string;
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

    const filePath = this.resolvePlanFilePath(
      input.workspacePath,
      input.sessionId,
      input.planId,
    );
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    await fs.writeFile(tmpPath, content, "utf8");
    await fs.rename(tmpPath, filePath);
    this.logger.debug(`Plan written: ${filePath} (${content.length} chars)`);
    return filePath;
  }

  /** 读回指定计划（不存在返回 null） */
  async readPlan(input: {
    workspacePath: string;
    sessionId: string;
    planId: string;
  }): Promise<{ path: string; content: string } | null> {
    const filePath = this.resolvePlanFilePath(
      input.workspacePath,
      input.sessionId,
      input.planId,
    );
    return this.readPlanFile(filePath);
  }

  /**
   * 读最近一份计划（压缩后重注入用）。
   *
   * 按文件 mtime 排序（写入即原子 rename 落盘，mtime ≈ 审批时刻）；
   * 无计划/全部读取失败返回 null。
   */
  async readLatestPlan(input: {
    workspacePath: string;
    sessionId: string;
  }): Promise<{ path: string; content: string } | null> {
    const dir = path.join(
      input.workspacePath,
      ".guada",
      "plans",
      sanitizeSegment(input.sessionId),
    );

    let names: string[];
    try {
      names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md"));
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      this.logger.warn(`Failed to list plans at ${dir}: ${error?.message}`);
      return null;
    }

    const stamped = (
      await Promise.all(
        names.map(async (name) => {
          const full = path.join(dir, name);
          try {
            const stat = await fs.stat(full);
            return { full, mtime: stat.mtimeMs };
          } catch {
            return null;
          }
        }),
      )
    ).filter((v): v is { full: string; mtime: number } => v !== null);

    if (stamped.length === 0) return null;
    stamped.sort((a, b) => b.mtime - a.mtime || b.full.localeCompare(a.full));

    return this.readPlanFile(stamped[0].full);
  }

  private async readPlanFile(
    filePath: string,
  ): Promise<{ path: string; content: string } | null> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      if (!content.trim()) return null;
      return { path: filePath, content };
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      // 读失败不阻断主流程（重注入是增强项，不是正确性依赖）
      this.logger.warn(`Failed to read plan at ${filePath}: ${error?.message}`);
      return null;
    }
  }
}
