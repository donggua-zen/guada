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
  Req,
  Headers,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { JwtService } from "@nestjs/jwt";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { SessionService } from "./session.service";
import { WorkspaceService } from "../../common/services/workspace.service";
import { PlanHistoryService } from "./plan-history.service";
import { EventBusService } from "../../common/events/event-bus.service";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { CreateSessionDto } from "./dto/create-session.dto";
import { BranchSessionDto } from "./dto/branch-session.dto";
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { resolveSessionAttachmentPath } from '../../common/utils/session-path.util';
import { resolveAttachmentResponseHeaders } from '../../common/utils/attachment-serving.util';
import { resolveServingMimeType } from '../../common/utils/media-type.util';

/** 预览类资源（位图/音视频/pdf）上限：浏览器按 Range 分块取，此处仅兜底防呆 */
const MAX_PREVIEW_ASSET_SIZE = 2 * 1024 * 1024 * 1024;
/** 其余二进制（.zip/.exe 之类不可预览的文件）上限，沿用原 10MB 策略 */
const MAX_BINARY_FILE_SIZE = 10 * 1024 * 1024;

@Controller()
@UseGuards(AuthGuard)
export class SessionsController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly workspaceService: WorkspaceService,
    private readonly eventBus: EventBusService,
    private readonly jwtService: JwtService,
    private readonly planHistoryService: PlanHistoryService,
  ) { }

  @Get("sessions")
  async getSessions(
    @Query("skip") skip = 0,
    @Query("limit") limit = 20,
    @Query("groupId") groupId: string | undefined,
    @Query("keyword") keyword: string | undefined,
    @Query("includeArchived") includeArchived: string | undefined,
  ) {
    // groupId 特殊值处理："null"字符串表示查询未分组会话
    const parsedGroupId = groupId === "null" ? null : groupId;
    return this.sessionService.getSessions(
      Number(skip),
      Number(limit),
      parsedGroupId,
      keyword?.trim() || undefined,
      includeArchived === "true",
    );
  }

  @Get("sessions/search")
  async searchSessions(
    @Query("keyword") keyword: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("includeArchived") includeArchived: string | undefined,
  ) {
    // limit = 每批扫描的会话数（渐进扫描，前端循环拉取直到 hasMore=false）
    return this.sessionService.searchSessions(
      keyword?.trim() || "",
      cursor,
      limit ? parseInt(limit, 10) : 25,
      includeArchived === "true",
    );
  }

  @Get("sessions/archived")
  async getArchivedSessions(
    @Query("skip") skip = 0,
    @Query("limit") limit = 50,
    @Query("keyword") keyword: string | undefined,
    @Query("groupId") groupId: string | undefined,
  ) {
    return this.sessionService.getArchivedSessions(
      Number(skip),
      Number(limit),
      keyword?.trim() || undefined,
      groupId,
    );
  }

  /**
   * 侧边栏批量加载：一次请求返回所有分组 + 各分组前 N 条会话
   */
  @Get("sessions/sidebar")
  async getSidebarSessions(
    @Query("limit") limit: string = "10",
  ) {
    return this.sessionService.getSidebarSessions(Number(limit));
  }

  @Put("sessions/:id/archive")
  async archiveSession(
    @Param("id") id: string,
    @Body() data: { archived: boolean },
  ) {
    return this.sessionService.archiveSession(id, data.archived);
  }

  @Post("sessions/batch-archive")
  async batchArchiveSessions(
    @Body() data: { sessionIds: string[]; archived: boolean },
  ) {
    return this.sessionService.batchArchiveSessions(data.sessionIds, data.archived);
  }

  @Post("sessions")
  async createSession(
    @Body() data: CreateSessionDto,
    @Headers("x-client-id") clientId: string,
  ) {
    const session = await this.sessionService.createSession(data);

    // 广播会话创建事件，携带 source 使前端能过滤自身事件
    this.eventBus.emit("session.created", {
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      source: clientId || undefined,
      payload: { session },
    });

    return session;
  }

  @Get("sessions/:id")
  async getSession(@Param("id") id: string) {
    return this.sessionService.getSessionById(id);
  }

  /**
   * 分支会话：以指定回合（助手消息所在回合）为节点，完整复制源会话为新会话
   */
  @Post("sessions/:id/branch")
  async branchSession(
    @Param("id") id: string,
    @Body() data: BranchSessionDto,
    @Headers("x-client-id") clientId: string,
  ) {
    const session = await this.sessionService.branchSession(id, {
      turnId: data.turnId,
      title: data.title,
    });

    // 广播会话创建事件，携带 source 使前端能过滤自身事件（其他客户端侧边栏同步出现分支会话）
    this.eventBus.emit("session.created", {
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      source: clientId || undefined,
      payload: { session },
    });

    return session;
  }

  @Put("sessions/:id")
  async updateSession(
    @Param("id") id: string,
    @Body() data: UpdateSessionDto,
    @Headers("x-client-id") clientId: string,
  ) {
    const session = await this.sessionService.updateSession(id, data);

    // 广播会话更新事件，携带 source 使前端能过滤自身事件
    this.eventBus.emit("session.updated", {
      sessionId: id,
      timestamp: new Date().toISOString(),
      source: clientId || undefined,
      payload: { session },
    });

    return session;
  }

  @Delete("sessions/:id")
  async deleteSession(
    @Param("id") id: string,
    @Query("deleteWorkspace") deleteWorkspace: string,
    @Headers("x-client-id") clientId: string,
  ) {
    const shouldDeleteWorkspace = deleteWorkspace === 'true';
    await this.sessionService.deleteSession(id, shouldDeleteWorkspace);

    // 广播会话删除事件，携带 source 使前端能过滤自身事件
    this.eventBus.emit("session.deleted", {
      sessionId: id,
      timestamp: new Date().toISOString(),
      source: clientId || undefined,
    });

    return { success: true };
  }

  @Post("sessions/:id/generate-title")
  async generateTitle(@Param("id") id: string) {
    return this.sessionService.generateTitle(id);
  }

  @Get("sessions/:id/summaries")
  async getSessionSummaries(
    @Param("id") id: string,
    @Query("limit") limit?: string,
  ) {
    return this.sessionService.getSessionSummaries(id, limit ? parseInt(limit, 10) : undefined);
  }

  @Post("sessions/:id/compress")
  async compressSession(
    @Param("id") id: string,
  ) {
    return this.sessionService.compressSession(id);
  }

  @Get("sessions/:id/workspace-path")
  async getWorkspacePath(@Param("id") id: string) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    // 解析会话工作目录路径（已自动确保目录存在）
    const workspacePath = await this.workspaceService.resolveSessionWorkspaceDir(session);

    return { workspacePath };
  }

  @Get("sessions/:id/todo")
  async getSessionTodo(@Param("id") id: string) {
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new HttpException("Session not found or unauthorized", HttpStatus.NOT_FOUND);
    }

    const workspacePath = await this.workspaceService.resolveSessionWorkspaceDir(session);
    const todoFile = path.join(workspacePath, ".guada", "todo", `${id}.json`);

    try {
      const raw = await fsPromises.readFile(todoFile, "utf-8");
      const store = JSON.parse(raw);
      return { items: store.items || [] };
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return { items: [] };
      }
      throw e;
    }
  }

  /**
   * 会话计划历史（计划模式产物）。
   *
   * 列表来自转录（计划身份 = ExitPlanMode 的 toolCallId），每项含状态（待审/已批准/已拒绝）
   * 与正文；item.path 为已落盘文件的工作区相对路径（未落盘为 null）——前端打开文件走
   * workspace/file 接口，绝对路径会被路径牢笼拒绝，故只回传相对路径。
   */
  @Get("sessions/:id/plans")
  async getSessionPlans(@Param("id") id: string) {
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    const workspacePath = await this.workspaceService.resolveSessionWorkspaceDir(session);
    return { plans: await this.planHistoryService.listPlans(id, workspacePath) };
  }

  @Get("sessions/:id/workspace/tree")
  async getWorkspaceTree(@Param("id") id: string) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    const workspacePath = await this.workspaceService.resolveSessionWorkspaceDir(session);

    const tree = await this.buildDirectoryTree(workspacePath, '', 0, 0);
    return { tree };
  }

  @Get("sessions/:id/workspace/file")
  async getWorkspaceFile(
    @Param("id") id: string,
    @Query("path") filePath: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    if (!filePath) {
      throw new Error("File path is required");
    }

    // 确定工作目录路径（已自动确保目录存在）
    const workspaceDir = await this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析文件路径并安全检查
    const resolvedPath = this.workspaceService.resolveFilePath(filePath, workspaceDir);

    // 确保文件在工作目录内
    if (!resolvedPath.startsWith(workspaceDir + path.sep) && resolvedPath !== workspaceDir) {
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

    // 设置预览 Cookie：让后续 html-preview 图片请求自动携带鉴权（URL 无需 token）
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    if (token) {
      const cookiePath = `/api/v1/sessions/${id}/workspace`;
      res.setHeader('Set-Cookie', `ws_token=${token}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=300`);
    }

    return res.json({
      path: filePath,
      name: path.basename(filePath),
      extension: ext,
      size: stat.size,
      content: content,
      mimeType: this.getMimeType(ext)
    });
  }

  /**
   * 保存工作区文件内容
   */
  @Post("sessions/:id/workspace/file")
  async saveWorkspaceFile(
    @Param("id") id: string,
    @Query("path") filePath: string,
    @Body() body: { content: string },
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new HttpException("Session not found or unauthorized", HttpStatus.FORBIDDEN);
    }

    if (!filePath) {
      throw new HttpException("File path is required", HttpStatus.BAD_REQUEST);
    }

    if (typeof body.content !== 'string') {
      throw new HttpException("Content must be a string", HttpStatus.BAD_REQUEST);
    }

    // 确定工作目录路径
    const workspaceDir = await this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析文件路径并安全检查
    const resolvedPath = this.workspaceService.resolveFilePath(filePath, workspaceDir);

    // 确保文件在工作目录内
    if (!resolvedPath.startsWith(workspaceDir + path.sep) && resolvedPath !== workspaceDir) {
      throw new HttpException("Access denied: File is outside workspace directory", HttpStatus.FORBIDDEN);
    }

    // 确保目标目录存在
    const dir = path.dirname(resolvedPath);
    await fsPromises.mkdir(dir, { recursive: true });

    // 写入文件
    await fsPromises.writeFile(resolvedPath, body.content, 'utf-8');

    // 触发文件变更事件（通知前端刷新）
    this.eventBus.emit('workspace.file.changed', { sessionId: id, path: filePath });

    return { success: true, path: filePath };
  }

  @Get("sessions/:id/workspace/children")
  async getWorkspaceChildren(
    @Param("id") id: string,
    @Query("path") dirPath: string,
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    if (!dirPath) {
      throw new Error("Directory path is required");
    }

    // 确定工作目录路径（已自动确保目录存在）
    const workspaceDir = await this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析目录路径并安全检查
    const resolvedDirPath = this.workspaceService.resolveFilePath(dirPath, workspaceDir);

    // 确保目录在工作目录内
    if (!resolvedDirPath.startsWith(workspaceDir + path.sep) && resolvedDirPath !== workspaceDir) {
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
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new Error("Session not found or unauthorized");
    }

    if (!filePath) {
      throw new Error("File path is required");
    }

    // 确定工作目录路径（已自动确保目录存在）
    const workspaceDir = await this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析文件路径并安全检查
    const resolvedPath = this.workspaceService.resolveFilePath(filePath, workspaceDir);

    // 确保文件在工作目录内
    if (!resolvedPath.startsWith(workspaceDir + path.sep) && resolvedPath !== workspaceDir) {
      throw new Error("Access denied: File is outside workspace directory");
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error("File not found");
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error("Cannot read directory as file");
    }

    // 根据扩展名设置 Content-Type（音视频/位图/pdf 走前后端契约表，否则 .mp4 会发成
    // application/octet-stream，<video>/<audio> 认不出容器）
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = this.getMimeType(ext);
    this.assertServableSize(mimeType, stat.size);
    res.setHeader('Content-Type', mimeType);

    // 用 sendFile 而非 createReadStream().pipe：express/send 自带 Range/206、Accept-Ranges、
    // ETag/Last-Modified —— <video>/<audio> 拖进度条、按块加载都依赖它；Content-Length 由 send
    // 按实际区间写入，故不再手动设置（预设全量长度会让 206 的响应头对不上）。
    // dotfiles: 'allow' 维持与原 createReadStream 相同的可见性（工作区内可能有 .xxx 目录）。
    res.sendFile(resolvedPath, { dotfiles: 'allow' }, (err) => {
      if (!err || res.headersSent) return;
      const status = (err as any).status || ((err as any).code === 'ENOENT' ? 404 : undefined);
      if (status === 404) {
        res.status(404).json({ message: 'File not found' });
      } else if (status === 403) {
        res.status(403).json({ message: 'Access denied: File is outside workspace directory' });
      } else {
        console.error(`[workspace/raw-file] sendFile failed: ${resolvedPath}: ${err.message}`);
        res.status(500).json({ message: 'File read failed' });
      }
    });
  }

  /**
   * 会话附件取图端点（sessions/<id>/images|previews/... 的字节）。
   *
   * 图片随会话数据目录存储（refType='session'，url 自包含），不再经过 /uploads
   * 静态挂载（那个挂载点也绝不能覆盖 sessions 根——里面是 JSONL 对话记录）。
   * 本端点受 controller 级 AuthGuard 保护；`<img>` 无法带 Authorization 头，
   * 走 query `?token=` 通道（auth.guard 已支持，workspace raw-file 同款）。
   *
   * 安全：路径解析全部收敛在 resolveSessionAttachmentPath（id 合法性 + 会话目录
   * 前缀校验），越界/穿越一律拒绝；大小上限与 workspace raw-file 一致（10MB）。
   */
  @Get("sessions/:id/attachments/raw-file")
  async getSessionAttachmentRawFile(
    @Param("id") id: string,
    @Query("path") filePath: string,
    @Res() res: Response,
  ) {
    const resolvedPath = resolveSessionAttachmentPath(id, filePath);
    if (!resolvedPath) {
      throw new Error("Access denied: invalid attachment path");
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error("File not found");
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error("Cannot read directory as file");
    }

    // 图片原图/缩略图都 ≤1024px JPEG（上传时已压），10MB 上限纯属防御
    const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
    if (stat.size > MAX_ATTACHMENT_SIZE) {
      throw new Error("File too large (max 10MB)");
    }

    // 位图 inline（<img> 需要渲染），其余类型一律强制下载（复用附件静态服务策略）
    const headers = resolveAttachmentResponseHeaders(resolvedPath);
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(resolvedPath);
    stream.pipe(res);
  }

  /**
   * HTML 预览端点 — 专为 iframe 预览设计
   * 标记为 @Public() 自行鉴权，通过 Set-Cookie 让子资源请求自动携带凭据
   */
  @Get("sessions/:id/workspace/html-preview/*filePath")
  @Public()
  async htmlPreview(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Express 5 通配符 *filePath 在多段路径下仅捕获最后一段，
    // 从原始 URL 提取完整路径以确保 pvz/index.html 等多段路径正确解析
    const prefix = `/workspace/html-preview/`;
    const urlPath = (req.originalUrl || req.url || '').split('?')[0];
    const prefixIdx = urlPath.indexOf(prefix);
    const filePath = prefixIdx !== -1
      ? decodeURIComponent(urlPath.substring(prefixIdx + prefix.length))
      : '';

    if (!filePath) {
      throw new HttpException("File path is required", HttpStatus.BAD_REQUEST);
    }

    // 从 query 参数或 Cookie 获取 token（项目未使用 cookie-parser，手动解析 Cookie 头）
    const queryToken = req.query?.token as string | undefined;
    const cookieHeader = req.headers?.cookie as string | undefined;
    const cookies = parseCookieHeader(cookieHeader);
    const jwtToken = queryToken || cookies.ws_token;
    if (!jwtToken) {
      throw new HttpException("Missing authentication token", HttpStatus.UNAUTHORIZED);
    }

    try {
      // 不传 secret：复用 JwtModule 的配置（与签发同源）
      await this.jwtService.verifyAsync(jwtToken);
    } catch {
      throw new HttpException("Invalid or expired token", HttpStatus.UNAUTHORIZED);
    }

    // 单账户：token 有效即放行，无归属校验
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new HttpException("Session not found", HttpStatus.NOT_FOUND);
    }

    // 设置 Cookie（仅首次请求需要，后续子资源请求自动携带）
    // 作用域限制在 html-preview 路径下，5分钟过期
    const cookiePath = `/api/v1/sessions/${id}/workspace/html-preview`;
    res.setHeader('Set-Cookie', `ws_token=${jwtToken}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=300`);

    // 确定工作目录路径
    const workspaceDir = await this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析文件路径并安全检查
    const resolvedPath = this.workspaceService.resolveFilePath(filePath, workspaceDir);
    if (!resolvedPath.startsWith(workspaceDir + path.sep) && resolvedPath !== workspaceDir) {
      throw new HttpException("Access denied: File is outside workspace directory", HttpStatus.FORBIDDEN);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new HttpException("File not found", HttpStatus.NOT_FOUND);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new HttpException("Cannot read directory as file", HttpStatus.BAD_REQUEST);
    }

    // 检查文件大小（媒体/位图/pdf 按预览上限放行，其余维持 10MB）
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = this.getMimeType(ext);
    this.assertServableSize(mimeType, stat.size);

    // 根据扩展名设置 Content-Type
    res.setHeader('Content-Type', mimeType);

    // 同 raw-file：sendFile 自带 Range/206/ETag，预览页里嵌的视频/大图才能按块加载；
    // Content-Length 由 send 按实际区间写入，不再手动设置。
    res.sendFile(resolvedPath, { dotfiles: 'allow' }, (err) => {
      if (!err || res.headersSent) return;
      const status = (err as any).status || ((err as any).code === 'ENOENT' ? 404 : undefined);
      if (status === 404) {
        res.status(404).end();
      } else {
        console.error(`[workspace/html-preview] sendFile failed: ${resolvedPath}: ${err.message}`);
        res.status(500).end();
      }
    });
  }

  @Delete("sessions/:id/workspace/file")
  async deleteWorkspaceFile(
    @Param("id") id: string,
    @Query("path") filePath: string,
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new HttpException("Session not found or unauthorized", HttpStatus.NOT_FOUND);
    }

    if (!filePath) {
      throw new HttpException("File path is required", HttpStatus.BAD_REQUEST);
    }

    // 确定工作目录路径
    const workspaceDir = await this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析文件路径并安全检查
    const resolvedPath = this.workspaceService.resolveFilePath(filePath, workspaceDir);

    // 确保文件在工作目录内
    if (!resolvedPath.startsWith(workspaceDir + path.sep) && resolvedPath !== workspaceDir) {
      throw new HttpException("Access denied: Path is outside workspace directory", HttpStatus.FORBIDDEN);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new HttpException("File or directory not found", HttpStatus.NOT_FOUND);
    }

    // 防止删除工作目录本身
    if (resolvedPath === workspaceDir) {
      throw new HttpException("Cannot delete workspace root directory", HttpStatus.BAD_REQUEST);
    }

    try {
      const stat = fs.statSync(resolvedPath);
      await fsPromises.rm(resolvedPath, { recursive: true, force: true });
      return { success: true, isDirectory: stat.isDirectory() };
    } catch (error: any) {
      throw new HttpException("Failed to delete: " + error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post("sessions/:id/workspace/rename")
  async renameWorkspaceFile(
    @Param("id") id: string,
    @Body() body: { path: string; newName: string },
  ) {
    // 验证会话归属权
    const session = await this.sessionService.getSessionById(id);
    if (!session) {
      throw new HttpException("Session not found or unauthorized", HttpStatus.NOT_FOUND);
    }

    if (!body.path || !body.newName) {
      throw new HttpException("Both path and newName are required", HttpStatus.BAD_REQUEST);
    }

    // 禁止非法文件名（包含路径分隔符）
    if (body.newName.includes('/') || body.newName.includes('\\')) {
      throw new HttpException("newName must not contain path separators", HttpStatus.BAD_REQUEST);
    }

    // 确定工作目录路径
    const workspaceDir = await this.workspaceService.resolveSessionWorkspaceDir(session);

    // 解析原文件路径并安全检查
    const resolvedPath = this.workspaceService.resolveFilePath(body.path, workspaceDir);

    // 确保文件在工作目录内
    if (!resolvedPath.startsWith(workspaceDir + path.sep) && resolvedPath !== workspaceDir) {
      throw new HttpException("Access denied: Path is outside workspace directory", HttpStatus.FORBIDDEN);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new HttpException("File or directory not found", HttpStatus.NOT_FOUND);
    }

    // 构造新路径（同级目录下改名）
    const parentDir = path.dirname(resolvedPath);
    const newPath = path.join(parentDir, body.newName);

    if (fs.existsSync(newPath)) {
      throw new HttpException("Target name already exists", HttpStatus.CONFLICT);
    }

    try {
      await fsPromises.rename(resolvedPath, newPath);
      const stat = fs.statSync(newPath);
      return {
        success: true,
        isDirectory: stat.isDirectory(),
        newPath: path.relative(workspaceDir, newPath).replace(/\\/g, '/'),
      };
    } catch (error: any) {
      throw new HttpException("Failed to rename: " + error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** 直出响应 MIME（文本/代码 + 契约表兜底，见 media-type.util） */
  private getMimeType(extension: string): string {
    return resolveServingMimeType(extension);
  }

  /**
   * 直出大小上限分层：预览类资源（位图/音视频/pdf）由浏览器按 Range 分块取，
   * 上限仅作兜底；其余二进制沿用 10MB。
   */
  private assertServableSize(mimeType: string, size: number): void {
    const isPreviewAsset =
      mimeType.startsWith('image/') ||
      mimeType.startsWith('audio/') ||
      mimeType.startsWith('video/') ||
      mimeType === 'application/pdf';
    const maxSize = isPreviewAsset ? MAX_PREVIEW_ASSET_SIZE : MAX_BINARY_FILE_SIZE;
    if (size > maxSize) {
      throw new HttpException(
        `File too large (max ${Math.floor(maxSize / 1024 / 1024)}MB)`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
  }
}

/**
 * 手动解析 Cookie 请求头
 * 项目未使用 cookie-parser 中间件，故手动解析
 */
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.substring(0, idx).trim();
      const value = pair.substring(idx + 1).trim();
      if (key) cookies[key] = value;
    }
  });
  return cookies;
}
