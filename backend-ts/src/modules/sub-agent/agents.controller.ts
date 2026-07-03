import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Logger,
} from "@nestjs/common";
import { AgentScannerService, AgentGroup } from "./agent-scanner.service";

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
