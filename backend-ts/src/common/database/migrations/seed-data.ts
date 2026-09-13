import type { PrismaClientLike } from "../migration.interface";

/**
 * 创建默认数据（首次安装时由 baseline 迁移调用）
 *
 * 现在**不创建任何默认数据**：
 * - 账户（用户名/密码/头像）权威来源是 `<SETTINGS_DIR>/account.json`，
 *   由 AccountBootstrapService 在启动时创建；密码默认未设置（免登录）
 * - 默认助手权威来源是 `bundled-agents/<id>/AGENT.md`，由 CharacterSeedService 补种
 *
 * 保留此函数以维持迁移调用契约。
 */
export async function seedDefaultData(_prisma: PrismaClientLike): Promise<void> {
  // 无默认数据需要写入 DB
}
