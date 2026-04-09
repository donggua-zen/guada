import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { McpServerService } from './mcp-server.service';

@Controller('mcp-servers')
@UseGuards(AuthGuard)
export class McpServersController {
  constructor(private readonly mcpService: McpServerService) {}

  @Get()
  async getAllServers(@CurrentUser() user: any) {
    return this.mcpService.getAllServers(user.sub);
  }

  @Get(':id')
  async getServer(@Param('id') id: string, @CurrentUser() user: any) {
    return this.mcpService.getServerById(id, user.sub);
  }

  @Post()
  async createServer(@Body() data: any, @CurrentUser() user: any) {
    return this.mcpService.createServer(data, user.sub);
  }

  @Put(':id')
  async updateServer(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
    return this.mcpService.updateServer(id, data, user.sub);
  }

  @Delete(':id')
  async deleteServer(@Param('id') id: string, @CurrentUser() user: any) {
    await this.mcpService.deleteServer(id, user.sub);
    return { success: true };
  }

  @Patch(':id/toggle')
  async toggleStatus(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
    @CurrentUser() user: any,
  ) {
    return this.mcpService.toggleServerStatus(id, body.enabled, user.sub);
  }

  @Post(':id/refresh-tools')
  async refreshTools(@Param('id') id: string, @CurrentUser() user: any) {
    return this.mcpService.refreshTools(id, user.sub);
  }
}
