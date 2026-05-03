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
import { Public } from "../auth/public.decorator";
import { ModelService } from "./model.service";

@Controller()
@UseGuards(AuthGuard)
export class ModelsController {
  constructor(private readonly modelService: ModelService) {}

  @Get("models")
  async getModels() {
    return this.modelService.getModelsAndProviders();
  }

  @Get("providers")
  async getProviders() {
    return this.modelService.getModelsAndProviders();
  }

  @Get("models/all")
  async getAllModels() {
    return this.modelService.getAllModelsAndProviders();
  }

  @Post("models")
  async createModel(@Body() data: any) {
    return this.modelService.addModel(data);
  }

  @Put("models/:id")
  async updateModel(
    @Param("id") id: string,
    @Body() data: any,
  ) {
    return this.modelService.updateModel(id, data);
  }

  @Delete("models/:id")
  async deleteModel(@Param("id") id: string) {
    await this.modelService.deleteModel(id);
    return { success: true };
  }

  @Public()
  @Get("providers/templates")
  async getProviderTemplates() {
    return this.modelService.getProviderTemplates();
  }

  @Public()
  @Post("providers/test-connection")
  async testConnection(@Body() data: any) {
    return this.modelService.testProviderConnection(data);
  }

  @Post("providers")
  async createProvider(@Body() body: any) {
    return this.modelService.addProvider(
      body.name,
      body.apiKey || body.api_key, // 支持 camelCase 和 snake_case
      body.apiUrl || body.api_url,
      body.provider,
      body.protocol,
      body.avatarUrl || body.avatar_url,
      body.attributes,
    );
  }

  @Put("providers/:id")
  async updateProvider(
    @Param("id") id: string,
    @Body() data: any,
  ) {
    return this.modelService.updateProvider(id, data);
  }

  @Delete("providers/:id")
  async deleteProvider(@Param("id") id: string) {
    await this.modelService.deleteProvider(id);
    return { success: true };
  }

  @Get("providers/:id/remote_models")
  async getRemoteModels(@Param("id") id: string) {
    return this.modelService.getRemoteModels(id);
  }

  @Put("models/:id/favorite")
  async toggleFavorite(@Param("id") id: string) {
    return this.modelService.toggleModelFavorite(id);
  }

  @Put("models/:id/toggle-active")
  async toggleActive(@Param("id") id: string) {
    return this.modelService.toggleModelActive(id);
  }
}
