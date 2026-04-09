import { Injectable, Logger } from '@nestjs/common';
import { McpClientService } from '../../common/mcp/mcp-client.service';
import { McpServerRepository } from '../../common/database/mcp-server.repository';

@Injectable()
export class McpServerService {
    private readonly logger = new Logger(McpServerService.name);

    constructor(
        private mcpRepo: McpServerRepository,
        private mcpClient: McpClientService,
    ) { }

    /**
     * 从 MCP 服务器获取工具列表
     */
    private async fetchToolsFromServer(serverUrl: string, headers: Record<string, any>): Promise<Record<string, any>> {
        try {
            const toolsDict = await this.mcpClient.listTools({
                url: serverUrl,
                headers: headers,
            });

            if (Object.keys(toolsDict).length > 0) {
                this.logger.log(`Successfully fetched ${Object.keys(toolsDict).length} tools from ${serverUrl}`);
            } else {
                this.logger.warn(`No tools found at ${serverUrl}. You can manually configure tools later.`);
            }

            return toolsDict;
        } catch (error: any) {
            this.logger.warn(`Failed to automatically fetch tools from ${serverUrl}: ${error.message}`);
            this.logger.log('Server will be created without tools. You can refresh tools manually later via API.');
            return {};
        }
    }

    async getAllServers(userId: string) {
        const servers = await this.mcpRepo.findAll(userId);
        return {
            items: servers,
            size: servers.length,
        };
    }

    async getServerById(id: string, userId: string) {
        const server = await this.mcpRepo.findById(id, userId);
        if (!server) throw new Error('MCP Server not found');
        return server;
    }

    async createServer(data: any, userId: string) {
        // 1. 先创建服务器记录
        const server = await this.mcpRepo.create({
            name: data.name,
            url: data.url,
            description: data.description,
            headers: data.headers || null,
            enabled: data.enabled !== undefined ? data.enabled : true,
            userId: userId,
        });

        // 2. 尝试获取工具列表（不阻塞创建流程）
        try {
            const headers = (data.headers as Record<string, any>) || {};
            const toolsDict = await this.fetchToolsFromServer(data.url, headers);

            // 3. 如果有获取到工具，更新服务器记录
            if (Object.keys(toolsDict).length > 0) {
                await this.mcpRepo.updateTools(server.id, toolsDict);
                this.logger.log(`Fetched ${Object.keys(toolsDict).length} tools for MCP server: ${server.name}`);
            }
        } catch (error: any) {
            this.logger.error(`Failed to fetch tools during creation: ${error.message}`);
            // 不抛出错误，允许服务器创建成功但无工具
        }

        return server;
    }

    async updateServer(id: string, data: any, userId: string) {
        // 获取当前服务器信息并验证归属权
        const currentServer = await this.mcpRepo.findById(id, userId);
        if (!currentServer) {
            throw new Error('MCP Server not found or unauthorized');
        }

        // 检查是否需要重新获取工具列表
        let needRefreshTools = false;
        let serverUrl = currentServer.url;
        let headers = (currentServer.headers as Record<string, any>) || {};

        if (data.url !== undefined && data.url !== currentServer.url) {
            needRefreshTools = true;
            serverUrl = data.url;
        }

        if (data.headers !== undefined) {
            const newHeaders = data.headers || {};
            const oldHeaders = (currentServer.headers as Record<string, any>) || {};
            if (JSON.stringify(newHeaders) !== JSON.stringify(oldHeaders)) {
                needRefreshTools = true;
                headers = newHeaders;
            }
        }

        // 准备更新数据
        const updateData: any = {};
        if (data.name !== undefined) updateData.name = data.name;
        if (data.url !== undefined) updateData.url = data.url;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.headers !== undefined) updateData.headers = data.headers;
        if (data.enabled !== undefined) updateData.enabled = data.enabled;

        // 执行更新（带权限校验）
        const server = await this.mcpRepo.update(id, updateData, userId);

        // 如果需要且提供了必要的信息，重新获取工具列表
        if (needRefreshTools && serverUrl) {
            try {
                const toolsDict = await this.fetchToolsFromServer(serverUrl, headers);
                if (Object.keys(toolsDict).length > 0) {
                    await this.mcpRepo.updateTools(id, toolsDict);
                    this.logger.log(`Refreshed ${Object.keys(toolsDict).length} tools for MCP server: ${server.name}`);
                }
            } catch (error: any) {
                this.logger.error(`Failed to refresh tools during update: ${error.message}`);
            }
        }

        return server;
    }

    async deleteServer(id: string, userId: string) {
        const success = await this.mcpRepo.delete(id, userId);
        if (!success) {
            throw new Error('MCP Server not found or unauthorized');
        }
        this.logger.log(`Deleted MCP server: ${id}`);
        return true;
    }

    async toggleServerStatus(id: string, enabled: boolean, userId: string) {
        const server = await this.mcpRepo.update(id, { enabled }, userId);
        if (!server) {
            throw new Error('MCP Server not found or unauthorized');
        }
        this.logger.log(`Toggled MCP server status: ${id} -> ${enabled ? 'enabled' : 'disabled'}`);
        return server;
    }

    async refreshTools(id: string, userId: string) {
        const server = await this.mcpRepo.findById(id, userId);
        if (!server) {
            throw new Error('MCP Server not found or unauthorized');
        }

        if (!server.url) {
            throw new Error('Server URL is required');
        }

        const headers = (server.headers as Record<string, any>) || {};
        const toolsDict = await this.fetchToolsFromServer(server.url, headers);

        if (Object.keys(toolsDict).length === 0) {
            throw new Error('Failed to fetch tools from server');
        }

        await this.mcpRepo.updateTools(id, toolsDict);
        this.logger.log(`Manually refreshed ${Object.keys(toolsDict).length} tools for MCP server: ${server.name}`);

        // 返回更新后的服务器信息
        return this.mcpRepo.findById(id);
    }
}
