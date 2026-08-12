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
import { RemoteWorkspaceService } from "./remote-workspace.service";

@Controller("remote-workspace")
@UseGuards(AuthGuard)
export class RemoteWorkspaceController {
  constructor(private readonly service: RemoteWorkspaceService) {}

  @Get("connections")
  async getConnections() {
    return this.service.getConnections();
  }

  @Post("connections")
  async createConnection(
    @Body() body: { name: string; config: any },
  ) {
    return this.service.createConnection(body.name, body.config);
  }

  @Put("connections/:id")
  async updateConnection(
    @Param("id") id: string,
    @Body() body: { name?: string; config?: any },
  ) {
    const result = await this.service.updateConnection(id, body);
    if (!result) return { error: "Connection not found" };
    return result;
  }

  @Delete("connections/:id")
  async deleteConnection(@Param("id") id: string) {
    const success = await this.service.deleteConnection(id);
    return { success };
  }

  @Post("connections/test")
  async testConnection(@Body() body: { config: any }) {
    return this.service.testConnection(body.config);
  }

  @Post("connections/deploy")
  async deployConnection(@Body() body: { config: any }) {
    return this.service.deployConnection(body.config);
  }

  @Post("connections/browse")
  async browsePath(
    @Body() body: { config: any; path: string },
  ) {
    return this.service.browsePath(body.config, body.path);
  }
}
