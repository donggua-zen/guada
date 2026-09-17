import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { AgentService } from "./agent.service";
import { FileInterceptor } from "@nestjs/platform-express";

@Controller()
@UseGuards(AuthGuard)
export class AgentsController {
  constructor(private readonly agentService: AgentService) {}

  @Get("agents")
  async getAgents(@Query() query: any) {
    const { skip = 0, limit = 20 } = query;
    return this.agentService.getAgents(Number(skip), Number(limit));
  }

  @Get("agents/:id")
  async getAgentById(@Param("id") id: string) {
    return this.agentService.getAgentById(id);
  }

  @Post("agents")
  async createAgent(@Body() data: any) {
    return this.agentService.createAgent(data);
  }

  @Put("agents/:id")
  async updateAgent(@Param("id") id: string, @Body() data: any) {
    return this.agentService.updateAgent(id, data);
  }

  @Delete("agents/:id")
  async deleteAgent(@Param("id") id: string) {
    await this.agentService.deleteAgent(id);
    return { success: true };
  }

  @Post("agents/:id/avatars")
  @UseInterceptors(FileInterceptor("avatar"))
  async uploadAvatar(@Param("id") id: string, @UploadedFile() file: any) {
    return this.agentService.uploadAvatar(id, file);
  }

  @Post("agents/import")
  async importAgents(
    @Body() data: { files: { content: string; filename: string }[] },
  ) {
    return this.agentService.importAgents(data.files || []);
  }
}
