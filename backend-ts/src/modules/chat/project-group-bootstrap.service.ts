import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROJECT_GROUP_PORT,
} from '../../common/store/ports/group.port';
import type { ProjectGroupPort } from '../../common/store/ports/group.port';
import { SESSION_META_PORT } from '../../common/store/ports/session-meta.port';
import type { SessionMetaPort } from '../../common/store/ports/session-meta.port';
import { qualifiesForProjectGroup } from '../../common/utils/workspace-key.util';
import { WorkspaceService } from '../../common/services/workspace.service';

/**
 * 目录分组一次性注册（启动期脚手架）。
 *
 * 为什么只做一次：如果每次启动都把新出现的目录注册成分组，用户删掉的分组会
 * 反复复活、自动生成目录会让侧栏无限膨胀（参考 zcode v3.14.3 的
 * `__zcode_internal_grouped_workspace_bootstrap_once__` 教训）。本类的做法是：
 *
 * - 首次启动扫描历史 `workspace_key`，把**合格**目录注册成 `project_groups` 行；
 * - 写入一次性注册标记后永不再扫；
 * - 之后的分组只来自「新建会话时写时注册」这一条明确路径；
 * - 自动生成目录 / `<baseDir>/public` 从不注册，因此天然落进「通用」桶。
 *
 * 幂等：`path_key` UNIQUE + `INSERT OR IGNORE`，重复执行不会覆盖用户改过的名字。
 *
 * 全部数据访问经 `ProjectGroupPort`，不再直连 `_meta.db`——企业版换成数据库后
 * 这段启动逻辑原样成立。
 */
@Injectable()
export class ProjectGroupBootstrapService {
  private readonly logger = new Logger(ProjectGroupBootstrapService.name);

  constructor(
    private readonly workspaceService: WorkspaceService,
    @Inject(PROJECT_GROUP_PORT)
    private readonly projectGroups: ProjectGroupPort,
    @Inject(SESSION_META_PORT) private readonly sessionMeta: SessionMetaPort,
  ) {}

  async run(): Promise<void> {
    try {
      // schema 迁移与派生列回填由 meta 驱动的 startup 完成，扫描结果即可用
      await this.sessionMeta.startup?.();

      const baseDir = await this.workspaceService.getEffectiveBaseDir();

      // 每次启动都收敛「策略失效」的分组（public / 自动生成目录）。
      // 必须在 marker 门控之前：否则老库里已注册的历史 public 分组永远清不掉。
      await this.reconcileInvalidGroups(baseDir);

      if (await this.projectGroups.isBootstrapped()) return;

      const rows = await this.projectGroups.listGroupCandidates();

      const now = new Date().toISOString();
      // 按最近活跃排序，position 即该顺序（后续由用户拖拽改写）
      let position = 0;
      let created = 0;
      for (const row of rows) {
        if (!row.path || !qualifiesForProjectGroup(row.path, baseDir)) continue;
        // 先查是否存在：position 只在真正新建时递增（已存在同 path_key 的分组
        // 保持既有顺序连续，不因本次扫描被顶开）
        const existing = await this.projectGroups.findProjectGroupByKey(
          row.pathKey,
        );
        if (existing) continue;
        await this.projectGroups.ensureProjectGroup({
          path: row.path,
          pathKey: row.pathKey,
          position,
        });
        created += 1;
        position += 1;
      }

      await this.projectGroups.markBootstrapped(now);
      this.logger.log(
        `Directory groups bootstrapped: ${created} created from ${rows.length} workspace key(s)`,
      );
    } catch (err) {
      // 不落 marker：下次启动重试（幂等）
      this.logger.error(`目录分组注册失败: ${String(err)}`);
      throw err;
    }
  }

  /**
   * 清理策略失效的分组行（public / 自动生成目录）。
   *
   * 只删 `name_overridden = 0` 的行：用户改过名是显式意图，不能因为判定规则
   * 收紧而静默丢弃。删除后该目录的会话自动回落到「通用」（成员关系是派生的），
   * 不触碰任何会话或磁盘文件。
   */
  private async reconcileInvalidGroups(baseDir: string): Promise<void> {
    const groups = await this.projectGroups.listProjectGroups();
    const stale = groups.filter(
      (group) =>
        !group.nameOverridden && !qualifiesForProjectGroup(group.path, baseDir),
    );
    if (stale.length === 0) return;

    for (const group of stale) {
      await this.projectGroups.deleteProjectGroup(group.id);
    }
    this.logger.log(
      `Removed ${stale.length} project group(s) that no longer qualify: ` +
        stale.map((group) => group.path).join(', '),
    );
  }
}
