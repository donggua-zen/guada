import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
  Req,
  Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionService } from "../chat/session.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import { GitService, GitFileChange } from "./git.service";
import * as path from "path";
import * as fsPromises from "fs/promises";

@Controller()
@UseGuards(AuthGuard)
export class GitController {
  private readonly logger = new Logger(GitController.name);

  constructor(
    private readonly gitService: GitService,
    private readonly sessionService: SessionService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  private async resolveWorkspacePath(
    sessionId: string,
    userId: string,
  ): Promise<string> {
    const session = await this.sessionService.getSessionById(sessionId, userId);
    if (!session) {
      throw new HttpException(
        "Session not found or unauthorized",
        HttpStatus.NOT_FOUND,
      );
    }
    return await this.workspaceService.resolveSessionWorkspaceDir(session);
  }

  /**
   * 校验文件路径必须位于工作目录内，并统一为正斜杠相对路径
   */
  private validateFilePaths(
    files: string[] | undefined,
    workspacePath: string,
  ): string[] | undefined {
    if (!files || files.length === 0) return undefined;
    return files.map((f) => {
      const normalized = f.replace(/\\/g, "/");
      const resolved = path.resolve(workspacePath, normalized);
      if (
        resolved !== workspacePath &&
        !resolved.startsWith(workspacePath + path.sep)
      ) {
        throw new HttpException(
          "Access denied: File is outside workspace directory",
          HttpStatus.FORBIDDEN,
        );
      }
      return normalized;
    });
  }

  private assertGitRepo(workspacePath: string): void {
    if (!this.gitService.isGitRepo(workspacePath)) {
      throw new HttpException(
        "Not a git repository",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** 系统未安装 git → 明确报错（避免每次调用 500 ENOENT） */
  private assertGitAvailable(): void {
    if (!this.gitService.isGitAvailable()) {
      throw new HttpException(
        "Git is not installed",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Get("sessions/:id/git/status")
  async getStatus(@Param("id") id: string, @CurrentUser() user: any) {
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    // 未安装 git：优雅降级（不弹错，前端展示「未安装 Git」提示）
    if (!this.gitService.isGitAvailable()) {
      return {
        isGitRepo: false,
        gitUnavailable: true,
        branch: null,
        ahead: 0,
        behind: 0,
        files: [],
        stagedAdditions: 0,
        stagedDeletions: 0,
      };
    }
    if (!this.gitService.isGitRepo(workspacePath)) {
      return { isGitRepo: false, branch: null, ahead: 0, behind: 0, files: [] };
    }
    const status = await this.gitService.getStatus(workspacePath);
    return { isGitRepo: true, ...status };
  }

  @Get("sessions/:id/git/branches")
  async getBranches(@Param("id") id: string, @CurrentUser() user: any) {
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    if (!this.gitService.isGitAvailable()) {
      return { branches: [] };
    }
    if (!this.gitService.isGitRepo(workspacePath)) {
      return { branches: [] };
    }
    const branches = await this.gitService.getBranches(workspacePath);
    return { branches };
  }

  @Post("sessions/:id/git/checkout")
  async checkout(
    @Param("id") id: string,
    @Body() body: { branch: string },
    @CurrentUser() user: any,
  ) {
    if (!body?.branch || typeof body.branch !== "string") {
      throw new HttpException("branch is required", HttpStatus.BAD_REQUEST);
    }
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    this.assertGitAvailable();
    this.assertGitRepo(workspacePath);
    return await this.gitService.checkout(workspacePath, body.branch);
  }

  @Post("sessions/:id/git/commit")
  async commit(
    @Param("id") id: string,
    @Body() body: { message: string; files?: string[] },
    @CurrentUser() user: any,
  ) {
    const message = body?.message?.trim();
    if (!message) {
      throw new HttpException(
        "commit message is required",
        HttpStatus.BAD_REQUEST,
      );
    }
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    this.assertGitAvailable();
    this.assertGitRepo(workspacePath);
    const files = this.validateFilePaths(body.files, workspacePath);
    return await this.gitService.commit(workspacePath, message, files);
  }

  @Post("sessions/:id/git/stage")
  async stage(
    @Param("id") id: string,
    @Body() body: { files?: string[] },
    @CurrentUser() user: any,
  ) {
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    this.assertGitAvailable();
    this.assertGitRepo(workspacePath);
    const files = this.validateFilePaths(body.files, workspacePath);
    return await this.gitService.stage(workspacePath, files);
  }

  @Post("sessions/:id/git/unstage")
  async unstage(
    @Param("id") id: string,
    @Body() body: { files?: string[] },
    @CurrentUser() user: any,
  ) {
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    this.assertGitAvailable();
    this.assertGitRepo(workspacePath);
    const files = this.validateFilePaths(body.files, workspacePath);
    return await this.gitService.unstage(workspacePath, files);
  }

  @Post("sessions/:id/git/push")
  async push(@Param("id") id: string, @CurrentUser() user: any) {
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    this.assertGitAvailable();
    this.assertGitRepo(workspacePath);
    return await this.gitService.push(workspacePath);
  }

  @Get("sessions/:id/git/diff")
  async getDiff(
    @Param("id") id: string,
    @Query("file") file: string,
    @Query("cached") cached: string,
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new HttpException("file is required", HttpStatus.BAD_REQUEST);
    }
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    this.assertGitAvailable();
    this.assertGitRepo(workspacePath);
    const [validatedFile] = this.validateFilePaths([file], workspacePath)!;
    return await this.gitService.getDiff(
      workspacePath,
      validatedFile,
      cached === "true",
    );
  }

  /**
   * 根据 git 变更流式生成提交信息（SSE，可取消）
   * body.includeUnstaged: 是否包含未暂存/未跟踪变更（与提交弹窗勾选联动，默认 true）
   * 事件：data: { type: "text", content } / { type: "done", message, modelName, modelSource } /
   *       { type: "skipped", reason }，结束为 data: [DONE]
   */
  @Post("sessions/:id/git/generate-commit-message")
  async generateCommitMessage(
    @Param("id") id: string,
    @Body() body: { includeUnstaged?: boolean },
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    this.assertGitAvailable();
    this.assertGitRepo(workspacePath);

    const status = await this.gitService.getStatus(workspacePath);
    const includeUnstaged = body?.includeUnstaged !== false;

    // 筛选变更文件：勾选「包含未暂存」= 暂存 + 未暂存/未跟踪；否则仅暂存
    const isStaged = (f: GitFileChange) => f.index !== "" && f.index !== "?";
    const isUnstaged = (f: GitFileChange) =>
      f.index === "?" || f.workingDir !== "";
    const files = status.files.filter((f) =>
      includeUnstaged ? isStaged(f) || isUnstaged(f) : isStaged(f),
    );

    // 拼接 diff 文本（带截断：最多 30 个文件、每文件 4000 字符、总 20000 字符）
    const MAX_FILES = 30;
    const MAX_PER_FILE = 4000;
    const MAX_TOTAL_CHARS = 20000;
    const diffParts: string[] = [];
    let totalChars = 0;

    for (const f of files.slice(0, MAX_FILES)) {
      if (totalChars >= MAX_TOTAL_CHARS) break;
      try {
        const cached = isStaged(f);
        const diff = await this.gitService.getDiff(
          workspacePath,
          f.path,
          cached,
        );
        // 二进制文件：无文本 diff，仅提交文件名供 LLM 参考
        // 注意：tooLarge（文件超 2MB）不算跳过——getDiff 已保留 diff/content，文件大 ≠ diff 大
        if (diff.binary) {
          diffParts.push(`### ${f.path}（二进制文件）`);
          totalChars += f.path.length;
          continue;
        }
        const text = (diff.diff || diff.content || "").slice(0, MAX_PER_FILE);
        if (!text.trim()) continue;
        diffParts.push(`### ${f.path}\n${text}`);
        totalChars += text.length;
      } catch (e: any) {
        this.logger.warn(`生成提交信息：跳过文件 ${f.path}: ${e?.message}`);
      }
    }

    if (diffParts.length === 0) {
      throw new HttpException(
        "No changes to generate commit message",
        HttpStatus.BAD_REQUEST,
      );
    }

    // 设置 SSE 响应头（与 chat/stream 一致）
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // 客户端断开/取消时中止底层 LLM 请求
    const abortController = new AbortController();
    const handleClose = () => abortController.abort();
    req.on("close", handleClose);

    const writeEvent = (data: any) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      // 读取项目提交约束（.guada/git/commit_constraint.md，不存在时为空串），注入生成提示
      const constraintPath = this.resolveConstraintPath(workspacePath);
      let constraintText = "";
      try {
        constraintText = await fsPromises.readFile(constraintPath, "utf-8");
      } catch (e: any) {
        if (e.code !== "ENOENT") {
          this.logger.warn(`读取提交约束失败: ${e?.message}`);
        }
      }

      const generator =
        this.sessionService.generateCommitMessageStream(
          diffParts.join("\n\n"),
          constraintText,
          abortController.signal,
        );
      for await (const event of generator) {
        if (res.writableEnded) break;
        writeEvent(event);
      }
    } catch (error: any) {
      this.logger.error(
        `生成提交信息流失败: ${error?.message || "Unknown error"}`,
      );
      writeEvent({ type: "skipped", reason: "error", error: error?.message });
    } finally {
      req.removeListener("close", handleClose);
      if (!res.writableEnded) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }
  }

  @Get("sessions/:id/git/file-lines")
  async getFileLines(
    @Param("id") id: string,
    @Query("file") file: string,
    @Query("cached") cached: string,
    @Query("from") from: string,
    @Query("to") to: string,
    @CurrentUser() user: any,
  ) {
    if (!file) {
      throw new HttpException("file is required", HttpStatus.BAD_REQUEST);
    }
    const fromNum = parseInt(from, 10);
    const toNum = parseInt(to, 10);
    if (!Number.isInteger(fromNum) || !Number.isInteger(toNum) || fromNum < 1 || toNum < fromNum) {
      throw new HttpException("Invalid line range", HttpStatus.BAD_REQUEST);
    }
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    this.assertGitAvailable();
    this.assertGitRepo(workspacePath);
    const [validatedFile] = this.validateFilePaths([file], workspacePath)!;
    return await this.gitService.getFileLines(
      workspacePath,
      validatedFile,
      cached === "true",
      fromNum,
      toNum,
    );
  }

  /** 会话工作目录下的提交约束文件路径（.guada/git/commit_constraint.md） */
  private resolveConstraintPath(workspacePath: string): string {
    return path.join(workspacePath, ".guada", "git", "commit_constraint.md");
  }

  /**
   * 读取项目提交约束（不存在时返回空内容）
   */
  @Get("sessions/:id/git/commit-constraint")
  async getCommitConstraint(
    @Param("id") id: string,
    @CurrentUser() user: any,
  ) {
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    const constraintPath = this.resolveConstraintPath(workspacePath);
    try {
      const content = await fsPromises.readFile(constraintPath, "utf-8");
      return { content };
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return { content: "" };
      }
      throw e;
    }
  }

  /**
   * 保存项目提交约束（写入 .guada/git/commit_constraint.md）
   */
  @Put("sessions/:id/git/commit-constraint")
  async saveCommitConstraint(
    @Param("id") id: string,
    @Body() body: { content?: string },
    @CurrentUser() user: any,
  ) {
    if (typeof body?.content !== "string") {
      throw new HttpException(
        "content is required",
        HttpStatus.BAD_REQUEST,
      );
    }
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    const constraintPath = this.resolveConstraintPath(workspacePath);
    await fsPromises.mkdir(path.dirname(constraintPath), { recursive: true });
    await fsPromises.writeFile(constraintPath, body.content, "utf-8");
    return { success: true };
  }
}
