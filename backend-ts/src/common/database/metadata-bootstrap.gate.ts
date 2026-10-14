import { Injectable } from "@nestjs/common";

/**
 * 元信息文件化引导的就绪门控
 *
 * 各域（sessions/bots/kb/mcp/account）的启动期一次性导出必须在任何 FileStore 读取索引之前
 * 完成——否则导出未完成时 store 读到空目录，会把用户数据"变没"（智能体迁移踩过的坑）。
 *
 * 用法：FileStore 在 initialize() 里 `await gate.wait(domain)`；引导服务完成导出后
 * `complete(domain)`。门控本身不依赖任何 provider（避免与 store 形成 DI 环）。
 *
 * 兜底：wait 带超时，引导服务异常缺席时不会永久挂起（超时后放行并告警）。
 */
@Injectable()
export class MetadataBootstrapGate {
  private readonly resolvers = new Map<string, () => void>();
  private readonly waits = new Map<string, Promise<void>>();
  private readonly completed = new Set<string>();

  /** 取（或建）某域的等待 promise */
  private waitPromise(domain: string): Promise<void> {
    let p = this.waits.get(domain);
    if (!p) {
      p = new Promise<void>((resolve) => {
        this.resolvers.set(domain, resolve);
      });
      this.waits.set(domain, p);
    }
    return p;
  }

  /**
   * 等待某域导出完成。
   * @param timeoutMs 兜底超时（默认 30s）；超时放行，避免引导缺席导致永久挂起
   */
  async wait(domain: string, timeoutMs = 30000): Promise<void> {
    if (this.completed.has(domain)) return;
    const pending = this.waitPromise(domain);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([pending, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 标记某域导出完成（放行所有等待者） */
  complete(domain: string): void {
    this.completed.add(domain);
    this.resolvers.get(domain)?.();
    this.resolvers.delete(domain);
  }

  isCompleted(domain: string): boolean {
    return this.completed.has(domain);
  }
}

/** 域常量（与各 FileStore 的 marker 一一对应） */
export const META_DOMAIN_SESSIONS = "sessions";
export const META_DOMAIN_BOTS = "bots";
export const META_DOMAIN_KB = "kb";
export const META_DOMAIN_MCP = "mcp";
/** 单账户：启动期从 DB 导入既有账户（防升级丢密码）后才可读账户文件 */
export const META_DOMAIN_ACCOUNT = "account";
/**
 * 供应商：LlmCoreModule（@Global 基座）在 app.module.ts 中位于 PersistenceModule
 * **之前**，其 ProviderFileStore 预热会先于 DB→文件导出跑完——不门控则把空索引
 * 缓存一整个会话（升级后首次启动"供应商全丢"，新增一个才触发全量重扫显示出来）。
 */
export const META_DOMAIN_PROVIDERS = "providers";
