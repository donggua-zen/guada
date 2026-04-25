import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 设置存储工具类
 * 
 * 负责设置的底层文件操作和内存缓存管理。
 * 这是一个纯技术实现类，不包含任何业务逻辑，可被任意模块安全引用。
 * 
 * @Injectable - 注册为 NestJS 单例服务，由容器统一管理生命周期
 */
@Injectable()
export class SettingsStorage {
  private readonly settingsDir: string;
  private cache: Record<string, any> = {};

  constructor(private readonly configService: ConfigService) {
    this.settingsDir = this.configService.get<string>('SETTINGS_DIR') || path.join(process.cwd(), '.config');
    
    // 确保目录存在
    if (!fs.existsSync(this.settingsDir)) {
      fs.mkdirSync(this.settingsDir, { recursive: true });
    }
  }

  /**
   * 获取指定分组的文件路径
   */
  private getFilePath(group: string): string {
    return path.join(this.settingsDir, `${group}.json`);
  }

  /**
   * 从磁盘加载指定分组到内存缓存
   */
  private loadGroup(group: string): void {
    // 已加载则跳过
    if (this.cache[group]) return;

    const filePath = this.getFilePath(group);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.cache[group] = JSON.parse(content);
      } else {
        this.cache[group] = {};
      }
    } catch (error) {
      console.error(`Failed to load config group ${group}:`, error);
      this.cache[group] = {};
    }
  }

  /**
   * 将指定分组从内存缓存原子性地写入磁盘
   */
  private saveGroup(group: string): void {
    const filePath = this.getFilePath(group);
    try {
      fs.writeFileSync(filePath, JSON.stringify(this.cache[group], null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to save config group ${group}:`, error);
      throw error;
    }
  }

  /**
   * 获取分组内所有设置
   * @param group 分组名称
   * @returns 设置对象的副本（防止外部直接修改缓存）
   */
  getSettings(group: string): any {
    this.loadGroup(group);
    return { ...this.cache[group] };
  }

  /**
   * 更新分组内的一个或多个设置项，并自动保存
   * @param group 分组名称
   * @param data 要更新的设置项
   */
  updateSettings(group: string, data: Record<string, any>): void {
    this.loadGroup(group);
    Object.assign(this.cache[group], data);
    this.saveGroup(group);
  }

  /**
   * 获取单个设置项的值
   * @param group 分组名称
   * @param key 设置项键名
   * @param defaultValue 默认值
   * @returns 设置项的值或默认值
   */
  getSettingValue(group: string, key: string, defaultValue: any = null): any {
    this.loadGroup(group);
    return this.cache[group][key] !== undefined ? this.cache[group][key] : defaultValue;
  }

  /**
   * 清除指定分组的缓存（用于测试或强制重新加载）
   * @param group 分组名称
   */
  clearCache(group: string): void {
    delete this.cache[group];
  }

  /**
   * 清除所有缓存
   */
  clearAllCache(): void {
    this.cache = {};
  }
}
