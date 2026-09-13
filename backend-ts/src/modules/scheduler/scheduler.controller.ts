import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { SchedulerService } from "./scheduler.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";

/**
 * 定时任务管理控制器
 *
 * 提供定时任务的 CRUD 和手动触发接口
 */
@Controller("scheduler")
@UseGuards(AuthGuard)
export class SchedulerController {
  constructor(private schedulerService: SchedulerService) {}

  /**
   * 获取所有定时任务
   */
  @Get("tasks")
  async getTasks() {
    const tasks = await this.schedulerService.getTasks();
    return { items: tasks, total: tasks.length };
  }

  /**
   * 获取预设的 cron 表达式列表
   */
  @Get("cron-presets")
  getCronPresets() {
    return this.schedulerService.getCronPresets();
  }

  /**
   * 创建定时任务
   */
  @Post("tasks")
  async createTask(@Body() dto: CreateTaskDto) {
    const task = await this.schedulerService.createTask(dto);
    return task;
  }

  /**
   * 获取单个任务详情
   */
  @Get("tasks/:id")
  async getTask(@Param("id") id: string) {
    return this.schedulerService.getTask(id);
  }

  /**
   * 更新定时任务
   */
  @Put("tasks/:id")
  async updateTask(@Param("id") id: string, @Body() dto: UpdateTaskDto) {
    return this.schedulerService.updateTask(id, dto);
  }

  /**
   * 删除定时任务
   */
  @Delete("tasks/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTask(@Param("id") id: string) {
    await this.schedulerService.deleteTask(id);
  }

  /**
   * 切换任务启用/禁用状态
   */
  @Post("tasks/:id/toggle")
  async toggleTask(@Param("id") id: string) {
    return this.schedulerService.toggleTask(id);
  }

  /**
   * 测试触发任务（无任何副作用）
   *
   * 特性：
   * - 失败不重试
   * - 不自动禁用任务
   * - 不记录执行日志
   * - 不更新执行次数和最后执行时间
   * - 仅验证任务本身的对话逻辑是否正常
   */
  @Post("tasks/:id/test")
  @HttpCode(HttpStatus.OK)
  async testTask(@Param("id") id: string) {
    await this.schedulerService.testTask(id);
    return { success: true, message: "测试执行完成" };
  }

  /**
   * 获取任务执行日志
   */
  @Get("tasks/:id/logs")
  async getTaskLogs(@Param("id") id: string) {
    const logs = await this.schedulerService.getTaskLogs(id);
    return { items: logs, total: logs.length };
  }

  /**
   * 获取所有任务执行日志（游标分页）
   */
  @Get("logs")
  async getAllLogs(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 30;
    return this.schedulerService.getAllLogs(cursor, parsedLimit);
  }
}
