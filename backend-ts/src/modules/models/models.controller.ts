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
import { CurrentUser } from "../auth/current-user.decorator";
import { ModelService } from "./model.service";

@Controller()
@UseGuards(AuthGuard)
export class ModelsController {
  constructor(private readonly modelService: ModelService) {}

  @Get("models")
  async getModels(@CurrentUser() user: any) {
    return this.modelService.getModelsAndProviders(user.sub);
  }

  @Get("providers")
  async getProviders(@CurrentUser() user: any) {
    return this.modelService.getModelsAndProviders(user.sub);
  }

  @Post("models")
  async createModel(@Body() data: any, @CurrentUser() user: any) {
    // 验证模型所属的 provider 是否属于当前用户
    const userId = user.sub;
    return this.modelService.addModel(data, userId);
  }

  @Put("models/:id")
  async updateModel(
    @Param("id") id: string,
    @Body() data: any,
    @CurrentUser() user: any,
  ) {
    return this.modelService.updateModel(id, data, user.sub);
  }

  @Delete("models/:id")
  async deleteModel(@Param("id") id: string, @CurrentUser() user: any) {
    await this.modelService.deleteModel(id, user.sub);
    return { success: true };
  }

  @Public()
  @Get("providers/templates")
  async getProviderTemplates() {
    return this.modelService.getProviderTemplates();
  }

  @Public()
  @Post("providers/test-connection")
  async testConnection(@Body() data: any, @CurrentUser() user: any) {
    // 如果用户已登录，传入 userId；否则传 null，由 Service 层处理
    return this.modelService.testProviderConnection(data, user?.sub);
  }

  @Post("providers")
  async createProvider(@Body() body: any, @CurrentUser() user: any) {
    return this.modelService.addProvider(
      user.sub,
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
    @CurrentUser() user: any,
  ) {
    // 过滤掉不允许更新的字段（由 Service 层处理）
    return this.modelService.updateProvider(id, data, user.sub);
  }

  @Delete("providers/:id")
  async deleteProvider(@Param("id") id: string, @CurrentUser() user: any) {
    await this.modelService.deleteProvider(id, user.sub);
    return { success: true };
  }

  @Get("providers/:id/remote_models")
  async getRemoteModels(@Param("id") id: string, @CurrentUser() user: any) {
    return this.modelService.getRemoteModels(user.sub, id);
  }
}
