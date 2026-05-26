import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { ScheduledTask, ScheduledTaskLog } from "./types/scheduler.types";

/**
 * 定时任务文件存储服务
 *
 * 使用 JSON 文件持久化定时任务及其执行日志，替代数据库存储。
 * 文件结构：
 * - data/scheduler/tasks.json    存储所有任务
 * - data/scheduler/logs.json     存储执行日志
 */
@Injectable()
export class TaskStorageService {
  private readonly logger = new Logger(TaskStorageService.name);
  private readonly storageDir: string;
  private readonly tasksFile: string;
  private readonly logsFile: string;

  // 内存缓存
  private tasksCache: Map<string, ScheduledTask> = new Map();
  private logsCache: Map<string, ScheduledTaskLog> = new Map();
  private isTasksLoaded = false;
  private isLogsLoaded = false;

  constructor() {
    this.storageDir = path.join(process.cwd(), "data", "scheduler");
    this.tasksFile = path.join(this.storageDir, "tasks.json");
    this.logsFile = path.join(this.storageDir, "logs.json");
    this.ensureDirectoryExists();
  }

  // ==================== 任务操作 ====================

  /**
   * 获取所有任务
   */
  async getAllTasks(): Promise<ScheduledTask[]> {
    await this.ensureTasksLoaded();
    return Array.from(this.tasksCache.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * 根据用户 ID 获取任务列表
   */
  async getTasksByUserId(userId: string): Promise<ScheduledTask[]> {
    const tasks = await this.getAllTasks();
    return tasks.filter((t) => t.userId === userId);
  }

  /**
   * 根据 ID 获取任务
   */
  async getTaskById(id: string): Promise<ScheduledTask | null> {
    await this.ensureTasksLoaded();
    return this.tasksCache.get(id) || null;
  }

  /**
   * 创建任务
   */
  async createTask(task: ScheduledTask): Promise<ScheduledTask> {
    await this.ensureTasksLoaded();
    this.tasksCache.set(task.id, task);
    await this.saveTasks();
    return task;
  }

  /**
   * 更新任务
   */
  async updateTask(id: string, updates: Partial<ScheduledTask>): Promise<ScheduledTask | null> {
    await this.ensureTasksLoaded();
    const task = this.tasksCache.get(id);
    if (!task) return null;

    const updated = { ...task, ...updates, updatedAt: new Date().toISOString() };
    this.tasksCache.set(id, updated);
    await this.saveTasks();
    return updated;
  }

  /**
   * 删除任务
   */
  async deleteTask(id: string): Promise<boolean> {
    await this.ensureTasksLoaded();
    const existed = this.tasksCache.delete(id);
    if (existed) {
      await this.saveTasks();
    }
    return existed;
  }

  // ==================== 日志操作 ====================

  /**
   * 获取所有日志
   */
  async getAllLogs(): Promise<ScheduledTaskLog[]> {
    await this.ensureLogsLoaded();
    return Array.from(this.logsCache.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }

  /**
   * 根据任务 ID 获取日志
   */
  async getLogsByTaskId(taskId: string): Promise<ScheduledTaskLog[]> {
    const logs = await this.getAllLogs();
    return logs.filter((l) => l.taskId === taskId);
  }

  /**
   * 创建日志
   */
  async createLog(log: ScheduledTaskLog): Promise<ScheduledTaskLog> {
    await this.ensureLogsLoaded();
    this.logsCache.set(log.id, log);
    await this.saveLogs();
    return log;
  }

  /**
   * 更新日志
   */
  async updateLog(id: string, updates: Partial<ScheduledTaskLog>): Promise<ScheduledTaskLog | null> {
    await this.ensureLogsLoaded();
    const log = this.logsCache.get(id);
    if (!log) return null;

    const updated = { ...log, ...updates };
    this.logsCache.set(id, updated);
    await this.saveLogs();
    return updated;
  }

  /**
   * 清理过期日志（保留最近 100 条）
   */
  async cleanupOldLogs(maxCount: number = 100): Promise<void> {
    await this.ensureLogsLoaded();
    const logs = await this.getAllLogs();
    if (logs.length > maxCount) {
      const toDelete = logs.slice(maxCount);
      for (const log of toDelete) {
        this.logsCache.delete(log.id);
      }
      await this.saveLogs();
      this.logger.log(`已清理 ${toDelete.length} 条过期日志`);
    }
  }

  // ==================== 文件操作 ====================

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
      this.logger.log(`Created scheduler storage directory: ${this.storageDir}`);
    }
  }

  private async ensureTasksLoaded(): Promise<void> {
    if (this.isTasksLoaded) return;

    try {
      if (fs.existsSync(this.tasksFile)) {
        const content = await fs.promises.readFile(this.tasksFile, "utf-8");
        const tasks: ScheduledTask[] = JSON.parse(content);
        for (const task of tasks) {
          this.tasksCache.set(task.id, task);
        }
        this.logger.log(`Loaded ${tasks.length} tasks from ${this.tasksFile}`);
      }
    } catch (error) {
      this.logger.error("Failed to load tasks:", error);
    }
    this.isTasksLoaded = true;
  }

  private async ensureLogsLoaded(): Promise<void> {
    if (this.isLogsLoaded) return;

    try {
      if (fs.existsSync(this.logsFile)) {
        const content = await fs.promises.readFile(this.logsFile, "utf-8");
        const logs: ScheduledTaskLog[] = JSON.parse(content);
        for (const log of logs) {
          this.logsCache.set(log.id, log);
        }
        this.logger.log(`Loaded ${logs.length} logs from ${this.logsFile}`);
      }
    } catch (error) {
      this.logger.error("Failed to load logs:", error);
    }
    this.isLogsLoaded = true;
  }

  private async saveTasks(): Promise<void> {
    const tasks = Array.from(this.tasksCache.values());
    await fs.promises.writeFile(this.tasksFile, JSON.stringify(tasks, null, 2), "utf-8");
  }

  private async saveLogs(): Promise<void> {
    const logs = Array.from(this.logsCache.values());
    await fs.promises.writeFile(this.logsFile, JSON.stringify(logs, null, 2), "utf-8");
  }
}
