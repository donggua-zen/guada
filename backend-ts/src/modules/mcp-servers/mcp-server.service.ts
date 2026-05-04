import { Injectable, Logger } from "@nestjs/common";
import { McpClientService } from "../../common/mcp/mcp-client.service";
import { McpServerRepository } from "../../common/database/mcp-server.repository";

@Injectable()
export class McpServerService {
  private readonly logger = new Logger(McpServerService.name);

  constructor(
    private mcpRepo: McpServerRepository,
    private mcpClient: McpClientService,
  ) {}

  /**
   * 验证 MCP 服务器配置
   */
  private validateServerConfig(url: string, headers?: Record<string, any>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // 验证 URL
    if (!url) {
      errors.push("URL is required");
    } else {
      try {
        new URL(url);
      } catch {
        errors.push("Invalid URL format");
      }
    }

    // 验证 headers 格式
    if (headers && typeof headers === "object") {
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value !== "string") {
          errors.push(`Header '${key}' value must be a string`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 从 MCP 服务器获取工具列表
   */
  private async fetchToolsFromServer(
    serverUrl: string | null,
    headers: Record<string, any> | null,
    type?: string,
    command?: string,
    args?: any[],
    env?: Record<string, string>,
    cwd?: string,
  ): Promise<Record<string, any>> {
    try {
      this.logger.log(
        `Attempting to fetch tools from: ${serverUrl || command}`,
      );

      const toolsDict = await this.mcpClient.listTools({
        url: serverUrl || undefined,
        headers: headers || undefined,
        type: type as "sse" | "streamableHttp" | "stdio" | undefined,
        command,
        args,
        env,
        cwd,
      });

      if (Object.keys(toolsDict).length > 0) {
        this.logger.log(
          `Successfully fetched ${Object.keys(toolsDict).length} tools from ${serverUrl || command}`,
        );
      } else {
        this.logger.warn(
          `No tools found at ${serverUrl || command}. You can manually configure tools later.`,
        );
      }

      return toolsDict;
    } catch (error: any) {
      // 提取更详细的错误信息
      let errorMessage = error.message;
      const originalError = (error as any).originalError;
      
      if (originalError) {
        // 检查是否是认证错误
        if (errorMessage.includes("InvalidApiKey") || 
            errorMessage.includes("401") || 
            errorMessage.includes("Unauthorized")) {
          this.logger.error(
            `Authentication failed for ${serverUrl || command}. Please check your API key in headers.`,
          );
        } else if (errorMessage.includes("content type") || 
                   errorMessage.includes("Unexpected")) {
          this.logger.warn(
            `Server ${serverUrl || command} returned an unexpected response format. This may be a compatibility issue.`,
          );
        } else {
          this.logger.warn(
            `Failed to automatically fetch tools from ${serverUrl}: ${errorMessage}`,
          );
        }
      } else {
        this.logger.warn(
          `Failed to automatically fetch tools from ${serverUrl}: ${errorMessage}`,
        );
      }
      
      this.logger.log(
        "Server will be created without tools. You can refresh tools manually later via API.",
      );
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
    if (!server) throw new Error("MCP Server not found");
    return server;
  }

  async createServer(data: any, userId: string) {
    // 验证配置
    const validation = this.validateServerConfig(data.url, data.headers);
    if (!validation.valid) {
      throw new Error(`Invalid server configuration: ${validation.errors.join(", ")}`);
    }

    // 1. 先创建服务器记录
    const server = await this.mcpRepo.create({
      name: data.name,
      url: data.url || null,
      type: data.type || null, // 保存协议类型
      description: data.description,
      headers: data.headers || null,
      command: data.command || null,
      args: data.args || null,
      env: data.env || null,
      cwd: data.cwd || null,
      enabled: data.enabled !== undefined ? data.enabled : true,
      userId: userId,
    });

    // 2. 尝试获取工具列表（不阻塞创建流程）
    try {
      if (data.type === "stdio" && data.command) {
        // stdio 协议
        const toolsDict = await this.fetchToolsFromServer(
          null,
          null,
          data.type,
          data.command,
          data.args,
          data.env,
          data.cwd,
        );
        if (Object.keys(toolsDict).length > 0) {
          await this.mcpRepo.updateTools(server.id, toolsDict);
          this.logger.log(
            `Fetched ${Object.keys(toolsDict).length} tools for MCP server: ${server.name}`,
          );
        }
      } else if (data.url) {
        // HTTP 协议
        const headers = (data.headers as Record<string, any>) || {};
        const toolsDict = await this.fetchToolsFromServer(data.url, headers, data.type);
        if (Object.keys(toolsDict).length > 0) {
          await this.mcpRepo.updateTools(server.id, toolsDict);
          this.logger.log(
            `Fetched ${Object.keys(toolsDict).length} tools for MCP server: ${server.name}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch tools during creation: ${error.message}`,
      );
      // 不抛出错误，允许服务器创建成功但无工具
    }

    return server;
  }

  async updateServer(id: string, data: any, userId: string) {
    // 获取当前服务器信息并验证归属权
    const currentServer = await this.mcpRepo.findById(id, userId);
    if (!currentServer) {
      throw new Error("MCP Server not found or unauthorized");
    }

    // 如果更新了 URL 或 headers，验证新配置
    if (data.url !== undefined || data.headers !== undefined) {
      const urlToValidate = data.url !== undefined ? data.url : currentServer.url;
      const headersToValidate = data.headers !== undefined ? data.headers : currentServer.headers;
      const validation = this.validateServerConfig(urlToValidate, headersToValidate);
      if (!validation.valid) {
        throw new Error(`Invalid server configuration: ${validation.errors.join(", ")}`);
      }
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
    if (data.url !== undefined) updateData.url = data.url || null;
    if (data.type !== undefined) updateData.type = data.type || null;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.headers !== undefined) updateData.headers = data.headers;
    if (data.command !== undefined) updateData.command = data.command || null;
    if (data.args !== undefined) updateData.args = data.args || null;
    if (data.env !== undefined) updateData.env = data.env || null;
    if (data.cwd !== undefined) updateData.cwd = data.cwd || null;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;

    // 执行更新（带权限校验）
    const server = await this.mcpRepo.update(id, updateData, userId);

    // 如果需要且提供了必要的信息，重新获取工具列表
    if (needRefreshTools) {
      try {
        let toolsDict: Record<string, any>;
        
        if (data.type === "stdio" && data.command) {
          // stdio 协议
          toolsDict = await this.fetchToolsFromServer(
            null,
            null,
            data.type,
            data.command,
            data.args,
            data.env,
            data.cwd,
          );
        } else if (serverUrl) {
          // HTTP 协议
          toolsDict = await this.fetchToolsFromServer(serverUrl, headers, data.type);
        } else {
          return server;
        }

        if (Object.keys(toolsDict).length > 0) {
          await this.mcpRepo.updateTools(id, toolsDict);
          this.logger.log(
            `Refreshed ${Object.keys(toolsDict).length} tools for MCP server: ${server.name}`,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to refresh tools during update: ${error.message}`,
        );
      }
    }

    return server;
  }

  async deleteServer(id: string, userId: string) {
    const success = await this.mcpRepo.delete(id, userId);
    if (!success) {
      throw new Error("MCP Server not found or unauthorized");
    }
    this.logger.log(`Deleted MCP server: ${id}`);
    return true;
  }

  async toggleServerStatus(id: string, enabled: boolean, userId: string) {
    const server = await this.mcpRepo.update(id, { enabled }, userId);
    if (!server) {
      throw new Error("MCP Server not found or unauthorized");
    }
    this.logger.log(
      `Toggled MCP server status: ${id} -> ${enabled ? "enabled" : "disabled"}`,
    );
    return server;
  }

  async refreshTools(id: string, userId: string) {
    const server = await this.mcpRepo.findById(id, userId);
    if (!server) {
      throw new Error("MCP Server not found or unauthorized");
    }

    if (!server.url) {
      throw new Error("Server URL is required");
    }

    const headers = (server.headers as Record<string, any>) || {};
    
    try {
      const toolsDict = await this.fetchToolsFromServer(server.url, headers, server.type);

      if (Object.keys(toolsDict).length === 0) {
        // 提供更详细的错误提示
        const errorMsg = `Failed to fetch tools from server. This could be due to:\n` +
          `1. Invalid API key or authentication credentials\n` +
          `2. Server returned an incompatible response format\n` +
          `3. Network connectivity issues\n` +
          `4. Server is temporarily unavailable\n\n` +
          `Please check your server configuration and try again.`;
        throw new Error(errorMsg);
      }

      await this.mcpRepo.updateTools(id, toolsDict);
      this.logger.log(
        `Manually refreshed ${Object.keys(toolsDict).length} tools for MCP server: ${server.name}`,
      );

      // 返回更新后的服务器信息
      return this.mcpRepo.findById(id);
    } catch (error: any) {
      // 如果是自定义的错误消息，直接抛出
      if (error.message.includes("Failed to fetch tools from server")) {
        throw error;
      }
      // 否则包装错误
      throw new Error(`Failed to refresh tools: ${error.message}`);
    }
  }
}
