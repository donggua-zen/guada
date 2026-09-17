import { Module } from "@nestjs/common";
import { TerminalService } from "./terminal.service";
import { TerminalGateway } from "./terminal.gateway";
import { TerminalController } from "./terminal.controller";
import { ChatModule } from "../chat/chat.module";
import { AuthModule } from "../auth/auth.module";

/**
 * 终端模块：后端 PTY（node-pty）+ WebSocket 桥
 *
 * - TerminalService：PTY 注册表（UI 终端 + Agent 终端）
 * - TerminalGateway：WS 网关（/api/v1/terminal/ws），鉴权 + 回放 + 输入转发
 *
 * 依赖：WorkspaceService（全局）、ConfigService（全局）、AccountFileStore（AuthModule 导出）
 *      SessionService（ChatModule 导出）、JwtModule（AuthModule 导出）
 */
@Module({
  imports: [ChatModule, AuthModule],
  controllers: [TerminalController],
  providers: [TerminalService, TerminalGateway],
  exports: [TerminalService],
})
export class TerminalModule {}
