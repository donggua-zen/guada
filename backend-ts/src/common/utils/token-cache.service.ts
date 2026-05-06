import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

/**
 * 缓存条目接口
 * 存储分词结果及其元数据
 */
interface CacheEntry {
  tokens: number;           // Token 数量
  createdAt: number;        // 创建时间戳（毫秒）
  textLength: number;       // 原始文本长度（用于内存估算）
}

/**
 * Token 缓存配置选项
 */
interface TokenCacheOptions {
  maxEntries: number;           // 最大缓存条目数
  maxMemoryBytes: number;       // 最大内存占用（字节）
  ttlMs: number;                // TTL 过期时间（毫秒）
  cleanupIntervalMs: number;    // 定期清理间隔（毫秒）
}

/**
 * 默认配置值
 */
const DEFAULT_OPTIONS: TokenCacheOptions = {
  maxEntries: 10000,
  maxMemoryBytes: 50 * 1024 * 1024, // 50MB
  ttlMs: 30 * 60 * 1000,            // 30分钟
  cleanupIntervalMs: 5 * 60 * 1000, // 5分钟
};

/**
 * Token 缓存服务
 * 
 * 提供基于 LRU + TTL 的分词结果缓存机制，用于优化重复文本的 Token 计算性能。
 * 
 * 核心特性：
 * - LRU 淘汰策略：自动移除最久未访问的缓存条目
 * - TTL 过期机制：支持惰性检查 + 定期清理
 * - 双重限制：同时控制条目数量和内存占用
 * - 线程安全：单例模式，NestJS 依赖注入管理生命周期
 * 
 * 使用场景：
 * - System Prompt 等固定文本的重复计算
 * - Tool Call JSON 序列化结果的缓存
 * - 高频对话中的相似消息片段
 */
@Injectable()
export class TokenCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TokenCacheService.name);
  
  // 缓存数据存储
  private cache = new Map<string, CacheEntry>();
  
  // 访问顺序列表（用于 LRU 淘汰）
  private accessOrder: string[] = [];
  
  // 当前估算的总内存占用（字节）
  private totalEstimatedBytes = 0;
  
  // 定期清理定时器
  private cleanupTimer: NodeJS.Timeout | null = null;
  
  // 配置选项
  private readonly options: TokenCacheOptions;

  /**
   * 构造函数
   * @param configService NestJS 配置服务，用于读取环境变量
   */
  constructor(private readonly configService: ConfigService) {
    // 从环境变量读取配置，提供默认值
    this.options = {
      maxEntries: this.configService.get<number>('TOKEN_CACHE_MAX_ENTRIES') || DEFAULT_OPTIONS.maxEntries,
      maxMemoryBytes: (this.configService.get<number>('TOKEN_CACHE_MAX_MEMORY_MB') || DEFAULT_OPTIONS.maxMemoryBytes / 1024 / 1024) * 1024 * 1024,
      ttlMs: this.configService.get<number>('TOKEN_CACHE_TTL_MS') || DEFAULT_OPTIONS.ttlMs,
      cleanupIntervalMs: this.configService.get<number>('TOKEN_CACHE_CLEANUP_INTERVAL_MS') || DEFAULT_OPTIONS.cleanupIntervalMs,
    };
  }

  /**
   * 模块初始化钩子
   * 启动定期清理定时器
   */
  onModuleInit() {
    this.cleanupTimer = setInterval(
      () => this.evictExpired(),
      this.options.cleanupIntervalMs,
    );
    this.logger.log(`Token cache initialized with maxEntries=${this.options.maxEntries}, maxMemory=${Math.round(this.options.maxMemoryBytes / 1024 / 1024)}MB, ttl=${Math.round(this.options.ttlMs / 1000 / 60)}min`);
  }

  /**
   * 模块销毁钩子
   * 清理定时器，释放资源
   */
  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.logger.log("Token cache destroyed");
  }

  /**
   * 生成缓存 Key
   * 使用 MD5 hash 确保唯一性和固定长度
   * 
   * @param modelName 模型名称
   * @param text 待分词的文本
   * @returns MD5 hash 字符串
   */
  generateKey(modelName: string, text: string): string {
    const hash = crypto.createHash("md5").update(`${modelName}::${text}`).digest("hex");
    return hash;
  }

  /**
   * 获取缓存的分词结果
   * 
   * 采用惰性过期检查：如果条目已过期，则删除并返回 null
   * 
   * @param key 缓存 Key
   * @returns Token 数量，未命中或已过期返回 null
   */
  get(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - entry.createdAt > this.options.ttlMs) {
      this.delete(key);
      return null;
    }

    // 更新访问顺序（LRU）
    this.touch(key);
    return entry.tokens;
  }

  /**
   * 设置缓存条目
   * 
   * 如果 Key 已存在，先删除旧条目再插入新条目
   * 插入后检查是否超出限制，触发 LRU 淘汰
   * 
   * @param key 缓存 Key
   * @param tokens Token 数量
   * @param modelName 模型名称（用于日志和调试）
   * @param text 原始文本（用于内存估算）
   */
  set(key: string, tokens: number, modelName: string, text: string): void {
    // 如果 Key 已存在，先删除旧条目
    if (this.cache.has(key)) {
      const old = this.cache.get(key)!;
      this.totalEstimatedBytes -= this.estimateSize(old.textLength);
      this.removeFromAccessOrder(key);
    }

    // 创建新条目
    const entry: CacheEntry = {
      tokens,
      createdAt: Date.now(),
      textLength: text.length,
    };

    // 插入缓存
    this.cache.set(key, entry);
    this.accessOrder.push(key);
    this.totalEstimatedBytes += this.estimateSize(text.length);

    // 检查并执行淘汰
    this.enforceLimits();
  }

  /**
   * 获取缓存统计信息
   * 
   * @returns 包含当前大小、内存占用和最大限制的统计对象
   */
  getStats(): { size: number; estimatedBytes: number; maxEntries: number; maxMemoryBytes: number } {
    return {
      size: this.cache.size,
      estimatedBytes: this.totalEstimatedBytes,
      maxEntries: this.options.maxEntries,
      maxMemoryBytes: this.options.maxMemoryBytes,
    };
  }

  /**
   * 清空所有缓存
   * 用于调试或紧急情况下重置缓存
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.totalEstimatedBytes = 0;
    this.logger.log("Token cache cleared");
  }

  /**
   * 更新条目的访问顺序（移动到末尾表示最近访问）
   * @param key 缓存 Key
   */
  private touch(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  /**
   * 删除缓存条目
   * @param key 缓存 Key
   */
  private delete(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.totalEstimatedBytes -= this.estimateSize(entry.textLength);
    }
    this.cache.delete(key);
    this.removeFromAccessOrder(key);
  }

  /**
   * 从访问顺序列表中移除指定 Key
   * @param key 缓存 Key
   */
  private removeFromAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }

  /**
   * 估算缓存条目的内存占用
   * 
   * 估算公式：textLength * 2 + 64
   * - textLength * 2: JavaScript 字符串使用 UTF-16 编码，每个字符占 2 字节
   * - 64: 固定开销（对象头、Map 节点、数字字段等）
   * 
   * @param textLength 文本长度
   * @returns 估算的字节数
   */
  private estimateSize(textLength: number): number {
    return textLength * 2 + 64;
  }

  /**
   * 强制执行缓存限制
   * 
   * 当条目数量或内存占用超过上限时，触发 LRU 淘汰
   * 从访问顺序列表头部开始删除最久未访问的条目
   */
  private enforceLimits(): void {
    while (
      this.cache.size > this.options.maxEntries ||
      this.totalEstimatedBytes > this.options.maxMemoryBytes
    ) {
      const oldest = this.accessOrder.shift();
      if (!oldest) break;
      
      const entry = this.cache.get(oldest);
      if (entry) {
        this.totalEstimatedBytes -= this.estimateSize(entry.textLength);
      }
      this.cache.delete(oldest);
    }
  }

  /**
   * 定期清理过期条目
   * 
   * 遍历所有缓存条目，删除已过期的条目
   * 这是 TTL 机制的第二道防线（第一道是 get 时的惰性检查）
   */
  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;
    
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.options.ttlMs) {
        this.delete(key);
        evicted++;
      }
    }
    
    if (evicted > 0) {
      this.logger.debug(`Evicted ${evicted} expired cache entries`);
    }
  }
}
