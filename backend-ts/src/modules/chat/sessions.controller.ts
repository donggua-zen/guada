import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  Headers,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionService } from "./session.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import { SessionEventsService } from "./session-events.service";
import { UpdateSessionDto } from "./dto/update-session.dto";
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

@Controller()
@UseGuards(AuthGuard)
export class SessionsController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly workspaceService: WorkspaceService,
    private readonly sessionEventsService: SessionEventsService,
  ) { }

  @Get("sessions")
  async getSessions(
    @Query("skip") skip = 0,
    @Query("limit") limit = 20,
    @Query("groupId") groupId: string | undefined,
    @CurrentUser() user: any,
  ) {
    // groupId 特殊值处理："null"字符串表示查询未分组会话
    const parsedGroupId = groupId === "null" ? null : groupId;
    return this.sessionService.getSessionsByUser(
      user.id,
      Number(skip),
      Number(limit),
      parsedGroupId,
    );
  }

  @Post("sessions")
  async createSession(
    @Body() data: any,
    @CurrentUser() user: any,
    @Headers("x-client-id") clientId: string,
  ) {
    const session = await this.sessionService.createSession(user.id, data);

    // 广播会话创建事件，携带 source 使前端能过滤自身事件
    this.sessionEventsService.broadcastToUser(user.id, {
      type: "session_created",
      userId: user.id,
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      source: clientId || undefined,
      payload: { session },
    });

    return session;
  }

  @Get("sessions/:id")
  async getSession(@Param("id") id: string, @CurrentUser() user: any) {
    return this.sessionService.getSessionById(id, user.id);
  }

  @Put("sessions/:id")
  async updateSession(
    @Param("id") id: string,
    @Body() data: UpdateSessionDto,
    @CurrentUser() user: any,
    @Headers("x-client-id") clientId: string,
  ) {
    const session = await this.sessionService.updateSession(id, user.id, data);

    // 广播会话更新事件，携带 source 使前端能过滤自身事件
    this.sessionEventsService.broadcastToUser(user.id, {
      type: "session_updated",
      userId: user.id,
      sessionId: id,
      timestamp: new Date().toISOString(),
      source: clientId || undefined,
      payload: { session },
    });

    return session;
  }

  @Put("sessions/:id/workspace-path")
  async updateWorkspacePath(
    @Param("id") id: string,
    @Body() body: { workspacePath: string },
    @CurrentUser() user: any
  ) {
    await this.sessionService.updateSessionWorkspacePath(id, user.id, body.workspacePath);
    return { success: true };
  }

  @Delete("sessions/:id")
  async deleteSession(
    @Param("id") id: string,
    @Query("deleteWorkspace") deleteWorkspace: string,
    @CurrentUser() user: any,
    @Headers("x-client-id") clientId: string,
  ) {
    const shouldDeleteWorkspace = deleteWorkspace === 'true';
    await this.sessionService.deleteSession(id, user.id, shouldDeleteWorkspace);

    // 广播会话删除事件，携带 source 使前端能过滤自身事件
    this.sessionEventsService.broadcastToUser(user.id, {
      type: "session_deleted",
      userId: user.id,
      sessionId: id,
      timestamp: new Date().toISOString(),
      source: clientId || undefined,
    });

    return { success: true };
  }

  @Post("sessions/:id/generate-title")
  async generateTitle(@Param("id") id: string, @CurrentUser() user: any) {
    return this.sessionService.generateTitle(id, user.id);
  }

  @Get("sessions/:id/summaries")
  async getSessionSummaries(@Param("id") id: string, @CurrentUser() user: any) {
    return this.sessionService.getSessionSummaries(id, user.id);
  }

  @Put("sessions/summaries/:summaryId")
  async updateSummary(
    @Param("summaryId") summaryId: string,
    @Body() body: { summaryContent?: string },
    @CurrentUser() user: any,
  ) {
    return this.sessionService.updateSummary(summaryId, user.id, body);
  }

  @Delete("sessions/summaries/:summaryId")
  async deleteSummary(
    @Param("summaryId") summaryId: string,
    @CurrentUser() user: any,
  ) {
    await this.sessionService.deleteSummary(summaryId, user.id);
    return { success: true };
  }

  @Get("sessions/:id/token-stats")
  async getTokenStats(@Param("id") id: string, @CurrentUser() user: any) {
    return this.sessionService.getTokenStats(id, user.id);
  }

  @Post("sessions/:id/compress")
  async compressSession(
    @Param("id") id: string,
    @CurrentUser() user: any,
  ) {
    return this.sessionService.compressSession(id, user.id);
  }

  @Get("sessions/:id/workspace-path")
  async getWorkspacePath(@Param("id") id: string, @CurrentUser() user: any) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    // 解析会话工作目录路径（已自动确保目录存在）
    const workspacePath = this.workspaceService.resolveSessionWorkspaceDir(session);

    return { workspacePath };
  }

  @Get("sessions/:id/workspace/tree")
  async getWorkspaceTree(@Param("id") id: string, @CurrentUser() user: any) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    const workspacePath = this.workspaceService.resolveSessionWorkspaceDir(session);

    const tree = await this.buildDirectoryTree(workspacePath, '', 0, 0);
    return { tree };
  }

  @Get("sessions/:id/workspace/file")
  async getWorkspaceFile(
    @Param("id") id: string,
    @Query("path") filePath: string,
    @CurrentUser() user: any
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    if (!filePath) {
      throw new Error("File path is required");
    }

    // 确定工作目录路径（已自动确保目录存在）
    const workspaceDir = this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析文件路径并安全检查
    const resolvedPath = this.workspaceService.resolveFilePath(filePath, workspaceDir);

    // 确保文件在工作目录内
    if (!resolvedPath.startsWith(workspaceDir)) {
      throw new Error("Access denied: File is outside workspace directory");
    }

    // 读取文件内容

    if (!fs.existsSync(resolvedPath)) {
      throw new Error("File not found");
    }

    const stat = fs.statSync(resolvedPath);

    // 如果是目录，返回错误
    if (stat.isDirectory()) {
      throw new Error("Cannot read directory as file");
    }

    // 检查文件大小（限制为 5MB）
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error("File too large to preview (max 5MB)");
    }

    // 读取文件内容
    const content = await fsPromises.readFile(resolvedPath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();

    return {
      path: filePath,
      name: path.basename(filePath),
      extension: ext,
      size: stat.size,
      content: content,
      mimeType: this.getMimeType(ext)
    };
  }

  @Get("sessions/:id/workspace/children")
  async getWorkspaceChildren(
    @Param("id") id: string,
    @Query("path") dirPath: string,
    @CurrentUser() user: any
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    if (!dirPath) {
      throw new Error("Directory path is required");
    }

    // 确定工作目录路径（已自动确保目录存在）
    const workspaceDir = this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析目录路径并安全检查
    const resolvedDirPath = this.workspaceService.resolveFilePath(dirPath, workspaceDir);

    // 确保目录在工作目录内
    if (!resolvedDirPath.startsWith(workspaceDir)) {
      throw new Error("Access denied: Directory is outside workspace directory");
    }

    // 检查目录是否存在
    if (!fs.existsSync(resolvedDirPath)) {
      throw new Error("Directory not found");
    }

    const stat = fs.statSync(resolvedDirPath);
    if (!stat.isDirectory()) {
      throw new Error("Path is not a directory");
    }

    // 获取子节点（只加载一层，递归深度为 0）
    const children = await this.buildDirectoryTree(resolvedDirPath, dirPath, 0, 0);
    return { children };
  }

  /**
   * 构建目录树（限制深度）
   * @param dirPath 目录路径
   * @param relativePath 相对路径
   * @param currentDepth 当前深度
   * @param maxDepth 最大深度（默认 3 层）
   */
  private async buildDirectoryTree(
    dirPath: string,
    relativePath: string = '',
    currentDepth: number = 0,
    maxDepth: number = 1
  ): Promise<any[]> {
    try {
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      const tree: any[] = [];

      // 只跳过 node_modules，保留隐藏目录（如 .guada）
      const filteredEntries = entries.filter(entry =>
        entry.name !== 'node_modules'
      );

      // 批量构建节点（并行化子目录递归）
      const nodePromises = filteredEntries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        const node: any = {
          name: entry.name,
          path: relPath,
          isDirectory: entry.isDirectory(),
        };

        if (entry.isDirectory()) {
          // 如果未达到最大深度，递归获取子目录
          if (currentDepth < maxDepth) {
            node.children = await this.buildDirectoryTree(fullPath, relPath, currentDepth + 1, maxDepth);
          } else {
            // 达到最大深度，标记为有子节点但不加载
            node.hasChildren = true;
            node.children = [];
          }
        }

        return node;
      });

      const nodes = await Promise.all(nodePromises);
      tree.push(...nodes);

      // 按名称排序，目录在前
      return tree.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (error: any) {
      console.error(`Failed to build directory tree: ${error.message}`);
      return [];
    }
  }

  @Get("sessions/:id/workspace/raw-file")
  async getWorkspaceRawFile(
    @Param("id") id: string,
    @Query("path") filePath: string,
    @Res() res: Response,
    @CurrentUser() user: any
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id, user.id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    if (!filePath) {
      throw new Error("File path is required");
    }

    // 确定工作目录路径（已自动确保目录存在）
    const workspaceDir = this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析文件路径并安全检查
    const resolvedPath = this.workspaceService.resolveFilePath(filePath, workspaceDir);

    // 确保文件在工作目录内
    if (!resolvedPath.startsWith(workspaceDir)) {
      throw new Error("Access denied: File is outside workspace directory");
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error("File not found");
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error("Cannot read directory as file");
    }

    // 检查文件大小（限制为 10MB）
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error("File too large (max 10MB)");
    }

    // 根据扩展名设置 Content-Type
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = this.getMimeType(ext);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);

    // 流式返回文件内容
    const stream = fs.createReadStream(resolvedPath);
    stream.pipe(res);
  }

  private getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.py': 'text/x-python',
      '.java': 'text/x-java',
      '.ts': 'application/typescript',
      '.vue': 'text/html',
      '.xml': 'application/xml',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.csv': 'text/csv',
      '.sql': 'application/sql',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
    };
    return mimeTypes[extension] || 'application/octet-stream';
  }
}
