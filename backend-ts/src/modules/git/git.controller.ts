import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionService } from "../chat/session.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import { GitService } from "./git.service";
import * as path from "path";

@Controller()
@UseGuards(AuthGuard)
export class GitController {
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

  @Get("sessions/:id/git/status")
  async getStatus(@Param("id") id: string, @CurrentUser() user: any) {
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
    if (!this.gitService.isGitRepo(workspacePath)) {
      return { isGitRepo: false, branch: null, ahead: 0, behind: 0, files: [] };
    }
    const status = await this.gitService.getStatus(workspacePath);
    return { isGitRepo: true, ...status };
  }

  @Get("sessions/:id/git/branches")
  async getBranches(@Param("id") id: string, @CurrentUser() user: any) {
    const workspacePath = await this.resolveWorkspacePath(id, user.id);
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
    this.assertGitRepo(workspacePath);
    const files = this.validateFilePaths(body.files, workspacePath);
    return await this.gitService.unstage(workspacePath, files);
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
    this.assertGitRepo(workspacePath);
    const [validatedFile] = this.validateFilePaths([file], workspacePath)!;
    return await this.gitService.getDiff(
      workspacePath,
      validatedFile,
      cached === "true",
    );
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
}
