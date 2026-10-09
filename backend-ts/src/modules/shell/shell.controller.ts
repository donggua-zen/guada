/**
 * 后台进程 UI 管理端点
 *
 * 供前端 OverviewPanel 后台进程区块使用：列出运行中进程、终止进程、查看日志尾部。
 * 与 AI 侧的 process 工具（kill/poll/write）共享 ProcessManagerService，
 * 但按 HTTP 语义校验会话归属，防止跨会话操作。
 */
import { Controller, Get, Post, Param, Query, UseGuards, HttpException, HttpStatus } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ProcessManagerService } from "./process-manager.service";

@Controller()
@UseGuards(AuthGuard)
export class ShellController {
  constructor(private readonly processManager: ProcessManagerService) {}

  /** 某会话当前运行中的后台进程列表（已结束的进程退出即消失） */
  @Get("sessions/:id/processes")
  listProcesses(@Param("id") id: string) {
    return {
      processes: this.processManager.listRunningBySession(id),
    };
  }

  /** 终止后台进程（进程不存在/不属于该会话 → 404） */
  @Post("sessions/:id/processes/:pid/kill")
  killProcess(
    @Param("id") id: string,
    @Param("pid") pid: string,
  ) {
    const status = this.processManager.killIfOwned(pid, id);
    if (status === null) {
      throw new HttpException("Process not found", HttpStatus.NOT_FOUND);
    }
    return { success: true, status };
  }

  /**
   * 读取后台进程日志尾部（默认 64KB）。
   * 进程已被清理（结束约 1s 内即从注册表消失）时改从磁盘日志文件读，
   * 返回 status="ended"；日志文件也不存在才 404。
   */
  @Get("sessions/:id/processes/:pid/log")
  async readProcessLog(
    @Param("id") id: string,
    @Param("pid") pid: string,
    @Query("tail") tail: string | undefined,
  ) {
    const tailBytes = Math.min(Math.max(Number(tail) || 65_536, 1024), 512 * 1024);
    const log = await this.processManager.readLogTail(pid, id, tailBytes);
    if (!log) {
      throw new HttpException("Process log not found", HttpStatus.NOT_FOUND);
    }
    return log;
  }
}
