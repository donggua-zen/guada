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
  Request,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { BotAdminService } from '../services/bot-admin.service';
import { CreateBotDto, UpdateBotDto } from '../dto/bot-admin.dto';

@Controller('bot-admin')
@UseGuards(AuthGuard)  // 所有接口都需要登录
export class BotAdminController {
  private readonly logger = new Logger(BotAdminController.name);

  constructor(private botService: BotAdminService) {}

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
  async getInstances(@Request() req) {
    const userId = req.user.sub;  // JWT payload 中用户ID在 sub 字段
    return this.botService.getAllInstances(userId);
  }

  /**
   * 获取单个机器人详情
   */
  @Get('instances/:id')
  async getInstance(@Param('id') id: string, @Request() req) {
    const userId = req.user.sub;  // JWT payload 中用户ID在 sub 字段
    const bot = await this.botService.getInstance(id);
    
    // 验证是否属于当前用户
    if (bot.userId !== userId) {
      throw new Error('无权访问此机器人');
    }
    
    return bot;
  }

  /**
   * 创建新机器人(自动关联当前用户)
   */
  @Post('instances')
  async createInstance(
    @Body() dto: CreateBotDto,
    @Request() req,
  ) {
    const userId = req.user.sub;  // JWT payload 中用户ID在 sub 字段
    this.logger.log(`Creating bot instance for user: ${userId}`);
    return this.botService.createInstance(userId, dto);
  }

  /**
   * 更新机器人配置
   */
  @Put('instances/:id')
  async updateInstance(
    @Param('id') id: string,
    @Body() dto: UpdateBotDto,
    @Request() req,
  ) {
    const userId = req.user.sub;  // JWT payload 中用户ID在 sub 字段
    
    // 验证是否属于当前用户
    const bot = await this.botService.getInstance(id);
    if (bot.userId !== userId) {
      throw new Error('无权修改此机器人');
    }
    
    return this.botService.updateInstance(id, dto);
  }

  /**
   * 启动机器人
   */
  @Post('instances/:id/start')
  async startInstance(@Param('id') id: string, @Request() req) {
    const userId = req.user.sub;  // JWT payload 中用户ID在 sub 字段
    
    // 验证是否属于当前用户
    const bot = await this.botService.getInstance(id);
    if (bot.userId !== userId) {
      throw new Error('无权操作此机器人');
    }
    
    return this.botService.startInstance(id);
  }

  /**
   * 停止机器人
   */
  @Post('instances/:id/stop')
  async stopInstance(@Param('id') id: string, @Request() req) {
    const userId = req.user.sub;  // JWT payload 中用户ID在 sub 字段
    
    // 验证是否属于当前用户
    const bot = await this.botService.getInstance(id);
    if (bot.userId !== userId) {
      throw new Error('无权操作此机器人');
    }
    
    return this.botService.stopInstance(id);
  }

  /**
   * 重启机器人
   */
  @Post('instances/:id/restart')
  async restartInstance(@Param('id') id: string, @Request() req) {
    const userId = req.user.sub;  // JWT payload 中用户ID在 sub 字段
    
    // 验证是否属于当前用户
    const bot = await this.botService.getInstance(id);
    if (bot.userId !== userId) {
      throw new Error('无权操作此机器人');
    }
    
    return this.botService.restartInstance(id);
  }

  /**
   * 删除机器人
   */
  @Delete('instances/:id')
  async deleteInstance(@Param('id') id: string, @Request() req) {
    const userId = req.user.sub;  // JWT payload 中用户ID在 sub 字段
    
    // 验证是否属于当前用户
    const bot = await this.botService.getInstance(id);
    if (bot.userId !== userId) {
      throw new Error('无权删除此机器人');
    }
    
    return this.botService.deleteInstance(id);
  }
}
