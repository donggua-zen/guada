import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { ClaudeImportService, type ImportSource } from "./claude-import.service";

@Controller("claude-import")
@UseGuards(AuthGuard)
export class ClaudeImportController {
  constructor(private readonly claudeImportService: ClaudeImportService) {}

  /**
   * 扫描可导入会话。
   * source: claudeCode（缺省）| zcode | dsh | codex | workbuddy。缺省值保证旧调用方行为不变。
   */
  @Post("scan")
  async scan(
    @Body()
    body: { source?: ImportSource; modifiedSince?: number; limit?: number } = {},
  ) {
    const source: ImportSource = this.normalizeSource(body?.source);
    const opts = {
      ...(typeof body?.modifiedSince === "number" ? { modifiedSince: body.modifiedSince } : {}),
      ...(typeof body?.limit === "number" ? { limit: body.limit } : {}),
    };
    if (source === "zcode") {
      return this.claudeImportService.scanZcodeSessions(opts);
    }
    if (source === "dsh") {
      return this.claudeImportService.scanDshSessions(opts);
    }
    if (source === "codex") {
      return this.claudeImportService.scanCodexSessions(opts);
    }
    if (source === "workbuddy") {
      return this.claudeImportService.scanWorkbuddySessions(opts);
    }
    return this.claudeImportService.scanClaudeSessions(opts);
  }

  /** 导入选中的会话（按 sessionId；source 决定读取哪个来源） */
  @Post("import")
  async import(
    @Body()
    body: {
      source?: ImportSource;
      sessionIds: string[];
      agentId?: string;
      groupId?: string;
    },
  ) {
    const source: ImportSource = this.normalizeSource(body?.source);
    const params = {
      sessionIds: Array.isArray(body?.sessionIds) ? body.sessionIds : [],
      ...(body?.agentId ? { agentId: body.agentId } : {}),
      ...(body?.groupId ? { groupId: body.groupId } : {}),
    };
    if (source === "zcode") {
      return this.claudeImportService.importZcodeSessions(params);
    }
    if (source === "dsh") {
      return this.claudeImportService.importDshSessions(params);
    }
    if (source === "codex") {
      return this.claudeImportService.importCodexSessions(params);
    }
    if (source === "workbuddy") {
      return this.claudeImportService.importWorkbuddySessions(params);
    }
    return this.claudeImportService.importClaudeSessions(params);
  }

  private normalizeSource(value?: ImportSource): ImportSource {
    if (value === "zcode") return "zcode";
    if (value === "dsh") return "dsh";
    if (value === "codex") return "codex";
    if (value === "workbuddy") return "workbuddy";
    return "claudeCode";
  }
}
