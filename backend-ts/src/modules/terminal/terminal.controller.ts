import { Controller, Delete, Param, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthGuard } from "../auth/auth.guard";
import { SessionService } from "../chat/session.service";
import { TerminalService } from "./terminal.service";

@Controller("terminal")
@UseGuards(AuthGuard)
export class TerminalController {
  constructor(
    private readonly terminalService: TerminalService,
    private readonly sessionService: SessionService,
  ) {}

  /** 显式关闭标签对应的 PTY；AuthGuard 由 AppModule 全局/控制器链路提供 */
  @Delete(":terminalId")
  async dispose(
    @Param("terminalId") terminalId: string,
    @CurrentUser() user: any,
  ) {
    const handle = this.terminalService.get(terminalId);
    const session = await this.sessionService.getSessionById(handle.sessionId);
    if (!session) throw new Error("Terminal not found or unauthorized");
    this.terminalService.disposeForSession(terminalId, handle.sessionId);
    return { success: true, terminalId };
  }
}
