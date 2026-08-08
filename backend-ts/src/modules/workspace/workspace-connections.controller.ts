import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkspaceConnectionsService } from "./workspace-connections.service";

@Controller("workspace")
@UseGuards(AuthGuard)
export class WorkspaceConnectionsController {
  constructor(private readonly service: WorkspaceConnectionsService) {}

  @Get("providers")
  async getProviders() {
    return this.service.getProviders();
  }

  @Get("connections")
  async getConnections() {
    return this.service.getConnections();
  }

  @Post("connections")
  async createConnection(
    @Body() body: { name: string; scheme: string; config: Record<string, any> },
    @CurrentUser() user: any,
  ) {
    return this.service.createConnection(body.name, body.scheme, body.config);
  }

  @Put("connections/:id")
  async updateConnection(
    @Param("id") id: string,
    @Body() body: { name?: string; config?: Record<string, any> },
  ) {
    const result = await this.service.updateConnection(id, body);
    if (!result) {
      return { error: "Connection not found" };
    }
    return result;
  }

  @Delete("connections/:id")
  async deleteConnection(@Param("id") id: string) {
    const success = await this.service.deleteConnection(id);
    return { success };
  }

  @Post("connections/test")
  async testConnection(
    @Body() body: { scheme: string; config: Record<string, any> },
  ) {
    return this.service.testConnection(body.scheme, body.config);
  }

  @Post("connections/browse")
  async browsePath(
    @Body() body: { scheme: string; config: Record<string, any>; path: string },
  ) {
    return this.service.browsePath(body.scheme, body.config, body.path);
  }
}
