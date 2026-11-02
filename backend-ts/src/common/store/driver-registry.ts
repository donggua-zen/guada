/**
 * 存储驱动注册表
 *
 * 核心发货的默认驱动在模块加载时注册（`sqlite` / `jsonl`）；企业包在自己的入口
 * 模块里 `registerStoreDriver(...)` 注册数据库/HTTP 驱动，**先于** Nest 容器创建。
 *
 * 选择机制（按域，缺省继承全局）：
 * - `GUADA_STORE_DRIVER`：全局默认（缺省 `sqlite`）
 * - `GUADA_STORE_DRIVER_SESSIONS`：会话元信息/分组/目录分组/资产
 * - `GUADA_STORE_DRIVER_MESSAGES`：事件日志（缺省 `jsonl`）
 * - `GUADA_STORE_DRIVER_USAGE`：用量账本（缺省 `sqlite`）
 *
 * 这样「元信息上 PG、轨迹走 HTTP」这种混合部署无需改代码。
 *
 * 依赖方向单向：核心源码不出现任何企业包名；企业包 import 核心。
 */
import { Logger } from '@nestjs/common';

/**
 * 存储域：每个域独立选驱动。
 *
 * `sessions` 与 `assets` 刻意分开：对企业版而言这两者介质通常不同——
 * 会话行/分组/目录分组进关系库，附件与图片进对象存储。
 * 若合并成一个域，企业驱动就得同时实现两类完全无关的端口。
 */
export type StoreDomain = 'sessions' | 'assets' | 'messages' | 'usage';

/**
 * 驱动名（核心内置 sqlite / jsonl / fs；企业包可注册任意名字）。
 *
 * 命名约定：驱动名 = **介质**，不是模块名。
 * - `sqlite`：`_meta.db`（会话行/分组/目录分组/用量）
 * - `jsonl`：事件日志文件
 * - `fs`：纯文件系统（会话资产容器）
 */
export type StoreDriverName = 'sqlite' | 'jsonl' | 'fs' | (string & {});

/**
 * 驱动工厂：返回该域的端口实现实例。
 * 工厂在 Nest provider 工厂内调用（此时 env 已就绪、DI 容器可用）。
 */
export type StoreDriverFactory = () => unknown;

const logger = new Logger('StoreDriverRegistry');

/** 已注册驱动：`domain -> (name -> factory)` */
const registry = new Map<StoreDomain, Map<string, StoreDriverFactory>>();

/**
 * 已构造实例：`domain -> (name -> instance)`。
 *
 * **必须缓存**：同一个域可能被多个端口 provider 反复解析（例如 `sessions` 域要供给
 * 会话行/分组/目录分组三个端口）。若每次都调工厂，企业驱动会被构造多份——
 * 多套连接池，且驱动内部的内存状态（缓存、游标）彼此不可见，属于静默的正确性缺陷。
 * 因此约定：**一个域一个实例**，该实例需实现该域的全部端口。
 */
const instances = new Map<StoreDomain, Map<string, unknown>>();

/** 注册一个域的驱动实现；返回注销函数（测试用） */
export function registerStoreDriver(
  domain: StoreDomain,
  name: StoreDriverName,
  factory: StoreDriverFactory,
): () => void {
  const byDomain = registry.get(domain) ?? new Map<string, StoreDriverFactory>();
  if (byDomain.has(name)) {
    throw new Error(`存储驱动重复注册：${domain}/${name}`);
  }
  byDomain.set(name, factory);
  registry.set(domain, byDomain);
  return () => {
    byDomain.delete(name);
    // 注销时同步丢弃实例，避免「已注销但仍被复用」
    instances.get(domain)?.delete(name);
  };
}

/** 读取某域的环境变量覆盖名 */
function envNameFor(domain: StoreDomain): string {
  switch (domain) {
    case 'sessions':
      return 'GUADA_STORE_DRIVER_SESSIONS';
    case 'assets':
      return 'GUADA_STORE_DRIVER_ASSETS';
    case 'messages':
      return 'GUADA_STORE_DRIVER_MESSAGES';
    case 'usage':
      return 'GUADA_STORE_DRIVER_USAGE';
  }
}

/**
 * 默认驱动名（按域）。
 *
 * 每个域的默认值必须反映**真实介质**：
 * - messages → jsonl（事件日志文件）
 * - assets   → fs（文件系统目录，与 SQLite 无关）
 * - sessions / usage → sqlite（`_meta.db`）
 */
export function defaultStoreDriverName(domain: StoreDomain): StoreDriverName {
  switch (domain) {
    case 'messages':
      return 'jsonl';
    case 'assets':
      return 'fs';
    case 'sessions':
    case 'usage':
      return 'sqlite';
  }
}

/**
 * 解析某域当前应使用的驱动名。
 * 优先级：域环境变量 > 全局 `GUADA_STORE_DRIVER` > 域默认。
 */
export function resolveStoreDriverName(domain: StoreDomain): StoreDriverName {
  return (
    process.env[envNameFor(domain)] ||
    process.env.GUADA_STORE_DRIVER ||
    defaultStoreDriverName(domain)
  );
}

/**
 * 取某域驱动工厂。未注册返回 undefined（调用方负责报错——启动期失败
 * 好过运行期静默退化为本地文件）。
 */
export function getStoreDriverFactory(
  domain: StoreDomain,
  name?: StoreDriverName,
): StoreDriverFactory | undefined {
  const resolved = name ?? resolveStoreDriverName(domain);
  return registry.get(domain)?.get(resolved);
}

/**
 * 构造某域驱动实例。
 * @throws 驱动未注册（提示企业包需在启动前 registerStoreDriver）
 */
export function createStoreDriver<T>(
  domain: StoreDomain,
  fallback?: () => T,
): T {
  const name = resolveStoreDriverName(domain);
  const factory = getStoreDriverFactory(domain, name);
  if (!factory) {
    if (fallback) {
      // 核心默认驱动：工厂未显式注册时退回本地实现（避免循环依赖）。
      // 不缓存 fallback —— 它通常就是 Nest 已注入的单例，缓存反而多余。
      logger.debug(`存储驱动 ${domain}/${name} 未注册，使用内置实现`);
      return fallback();
    }
    throw new Error(
      `存储驱动未注册：${domain}=${name}。` +
        `企业包需在应用启动前调用 registerStoreDriver('${domain}', '${name}', ...)。`,
    );
  }

  // 同域同驱动只构造一次（见上方 instances 注释）
  const byDomain = instances.get(domain) ?? new Map<string, unknown>();
  if (!byDomain.has(name)) {
    byDomain.set(name, factory());
    instances.set(domain, byDomain);
  }
  return byDomain.get(name) as T;
}

/** 测试用：清空注册表（不用于生产） */
export function __resetStoreDriversForTest(): void {
  registry.clear();
  instances.clear();
}
