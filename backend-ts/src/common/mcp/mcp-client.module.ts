import { Module, Global } from "@nestjs/common";
import { McpClientService } from "./mcp-client.service";
import { McpConnectionManager } from "./mcp-connection-manager.service";

/**
 * MCP 客户端模块
 *
 * 全局模块，提供统一的 MCP 通信服务。
 *
 * 两个 provider 的分工：McpConnectionManager 管连接（复用/续活/进程回收/超时），
 * McpClientService 管协议请求与结果塑形。对外只暴露 McpClientService，
 * 但 McpConnectionManager 也导出——配置变更与关闭流程需要按服务器 id 显式释放连接。
 */
@Global()
@Module({
  providers: [McpConnectionManager, McpClientService],
  exports: [McpClientService, McpConnectionManager],
})
export class McpClientModule {}
