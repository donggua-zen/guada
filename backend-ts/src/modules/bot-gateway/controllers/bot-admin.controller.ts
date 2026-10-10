import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { BotAdminService } from '../services/bot-admin.service';
import { CreateBotDto, UpdateBotDto, SubmitBotVerificationDto } from '../dto/bot-admin.dto';

/**
 * 机器人管理（单账户）
 *
 * 鉴权仅由 AuthGuard 承担（能否访问本服务）；单账户下无归属校验。
 */
@Controller('bot-admin')
@UseGuards(AuthGuard)
export class BotAdminController {
  private readonly logger = new Logger(BotAdminController.name);

  constructor(private botService: BotAdminService) { }

  /**
   * 获取所有支持的平台列表
   */
  @Get('platforms')
  getPlatforms() {
    return this.botService.getPlatforms();
  }

  /**
   * 获取指定平台的配置字段定义
   */
  @Get('platforms/:platform/fields')
  getPlatformFields(@Param('platform') platform: string) {
    return this.botService.getPlatformFields(platform);
  }

  /**
   * 获取当前用户的所有机器人实例列表
   */
  @Get('instances')
  async getInstances() {
    return this.botService.getAllInstances();
  }

  /**
   * 获取机器人登录二维码状态（必须在 instances/:id 之前定义）
   */
  @Get('instances/:id/qr')
  async getQrCode(@Param('id') id: string) {
    return this.botService.getQrCodeStatus(id);
  }

  /**
   * 提交扫码登录的数字配对码
   */
  @Post('instances/:id/verification')
  async submitVerification(
    @Param('id') id: string,
    @Body() dto: SubmitBotVerificationDto,
  ) {
    return this.botService.submitVerification(id, dto.code);
  }

  /**
   * 退出机器人登录
   */
  @Post('instances/:id/logout')
  async logoutBot(@Param('id') id: string) {
    return this.botService.logout(id);
  }

  /**
   * 获取单个机器人详情
   */
  @Get('instances/:id')
  async getInstance(@Param('id') id: string) {
    return this.botService.getInstance(id);
  }

  /**
   * 创建新机器人
   */
  @Post('instances')
  async createInstance(@Body() dto: CreateBotDto) {
    return this.botService.createInstance(dto);
  }

  /**
   * 更新机器人配置
   */
  @Put('instances/:id')
  async updateInstance(@Param('id') id: string, @Body() dto: UpdateBotDto) {
    return this.botService.updateInstance(id, dto);
  }

  /**
   * 启动机器人
   */
  @Post('instances/:id/start')
  async startInstance(@Param('id') id: string) {
    return this.botService.startInstance(id);
  }

  /**
   * 停止机器人
   */
  @Post('instances/:id/stop')
  async stopInstance(@Param('id') id: string) {
    return this.botService.stopInstance(id);
  }

  /**
   * 重启机器人
   */
  @Post('instances/:id/restart')
  async restartInstance(@Param('id') id: string) {
    return this.botService.restartInstance(id);
  }

  /**
   * 删除机器人
   */
  @Delete('instances/:id')
  async deleteInstance(@Param('id') id: string) {
    return this.botService.deleteInstance(id);
  }

  /**
   * 获取当前用户的 Bot 专属会话列表（sessionType='bot'）
   */
  @Get('sessions')
  async getBotSessions(
    @Query('skip') skip: string = '0',
    @Query('limit') limit: string = '20',
    @Query('botId') botId?: string,
  ) {
    return this.botService.getBotSessions(Number(skip), Number(limit), botId);
  }
}
