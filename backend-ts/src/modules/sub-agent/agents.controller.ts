import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  Logger,
} from "@nestjs/common";
import {
  AgentScannerService,
  AgentGroup,
  CreateAgentDto,
  UpdateAgentDto,
} from "./agent-scanner.service";

@Controller("agents")
export class AgentsController {
  private readonly logger = new Logger(AgentsController.name);

  constructor(private readonly agentScanner: AgentScannerService) {}

  /**
   * 获取所有 Agent + 文件夹列表
   */
  @Get()
  async listAgents() {
    const agents = await this.agentScanner.listAgents();
    const groups = await this.agentScanner.listGroups();
    return {
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        color: a.color,
        emoji: a.emoji,
        visible: a.visible,
        folder: a.folder,
        folderVisible: a.folderVisible,
      })),
      groups,
      agentsDir: this.agentScanner.agentsDirectory,
    };
  }

  /**
   * 获取单个 Agent 详情（含完整 body）
   * 前端应 encodeURIComponent 处理含 / 的 ID
   */
  @Get(":id")
  async getAgent(@Param("id") id: string) {
    // 先尝试作为 agent 查找
    const agent = await this.agentScanner.getAgent(id);
    if (agent) {
      return {
        success: true,
        data: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          color: agent.color,
          emoji: agent.emoji,
          visible: agent.visible,
          filePath: agent.filePath,
          body: agent.body,
          folder: agent.folder,
        },
      };
    }
    return { success: false, message: `Agent ${id} 不存在` };
  }

  /**
   * 批量导入 Agent（.md 文件）
   */
  @Post("import")
  async importAgents(
    @Body() body: { files: { content: string; filename: string }[]; folder?: string },
  ) {
    if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
      return { success: false, message: "files 不能为空" };
    }
    try {
      const results = await this.agentScanner.importAgents(
        body.files,
        body.folder,
      );
      const ok = results.filter((r) => r.status === "ok").length;
      const conflict = results.filter((r) => r.status === "conflict").length;
      const invalid = results.filter((r) => r.status === "invalid").length;
      return { success: true, results, summary: { total: results.length, ok, conflict, invalid } };
    } catch (err: any) {
      this.logger.error(`导入 Agent 失败: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  /**
   * 创建新 Agent
   */
  @Post()
  async createAgent(@Body() body: CreateAgentDto) {
    try {
      const agent = await this.agentScanner.createAgent(body);
      return { success: true, data: agent };
    } catch (err: any) {
      this.logger.error(`创建 Agent 失败: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  /**
   * 更新 Agent（含 body）
   */
  @Put(":id")
  async updateAgent(
    @Param("id") id: string,
    @Body() body: UpdateAgentDto,
  ) {
    try {
      const agent = await this.agentScanner.updateAgent(id, body);
      return { success: true, data: agent };
    } catch (err: any) {
      this.logger.error(`更新 Agent 失败: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  /**
   * 切换可见性（支持 agent 和文件夹）
   */
  @Put(":id/visibility")
  async updateVisibility(
    @Param("id") id: string,
    @Body() body: { visible: boolean; collapsed?: boolean },
  ) {
    const success = await this.agentScanner.setVisibility(
      id,
      body.visible,
      body.collapsed,
    );
    if (!success) {
      return { success: false, message: `${id} 不存在或更新失败` };
    }
    return { success: true, visible: body.visible, collapsed: body.collapsed };
  }

  /**
   * 删除（支持 agent 文件和文件夹）
   */
  @Delete(":id")
  async deleteAgent(@Param("id") id: string) {
    const success = await this.agentScanner.deleteAgent(id);
    if (!success) {
      return { success: false, message: `${id} 不存在或删除失败` };
    }
    return { success: true };
  }
}
