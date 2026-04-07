import { Module, Global } from '@nestjs/common';
import { McpClientService } from './mcp-client.service';

/**
 * MCP 客户端模块
 * 
 * 全局模块，提供统一的 MCP 通信服务
 */
@Global()
@Module({
    providers: [McpClientService],
    exports: [McpClientService],
})
export class McpClientModule {}
