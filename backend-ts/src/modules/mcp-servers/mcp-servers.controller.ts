import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { McpServerService } from "./mcp-server.service";

@Controller("mcp-servers")
@UseGuards(AuthGuard)
export class McpServersController {
  constructor(private readonly mcpService: McpServerService) {}

  @Get()
  async getAllServers() {
    return this.mcpService.getAllServers();
  }

  @Get(":id")
  async getServer(@Param("id") id: string) {
    return this.mcpService.getServerById(id);
  }

  @Post()
  async createServer(@Body() data: any) {
    return this.mcpService.createServer(data);
  }

  @Put(":id")
  async updateServer(
    @Param("id") id: string,
    @Body() data: any,
  ) {
    return this.mcpService.updateServer(id, data);
  }

  @Delete(":id")
  async deleteServer(@Param("id") id: string) {
    await this.mcpService.deleteServer(id);
    return { success: true };
  }

  @Patch(":id/toggle")
  async toggleStatus(
    @Param("id") id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.mcpService.toggleServerStatus(id, body.enabled);
  }

  @Post(":id/refresh-tools")
  async refreshTools(@Param("id") id: string) {
    return this.mcpService.refreshTools(id);
  }
}
