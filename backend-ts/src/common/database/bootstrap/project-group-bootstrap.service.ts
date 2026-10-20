import { Injectable, Logger } from "@nestjs/common";
import type Database from "better-sqlite3";
import {
  PROJECT_GROUPS_BOOTSTRAPPED_KEY,
  openMetaDb,
} from "../../../modules/chat/session-meta.store";
import { resolveSessionsBasePath } from "../../utils/session-path.util";
import {
  qualifiesForProjectGroup,
  workspaceBasename,
} from "../../utils/workspace-key.util";
import { ID_PREFIXES } from "../../utils/id.util";
import { mintId } from "../../persistence/file-store-kit";
import { WorkspaceService } from "../../services/workspace.service";

/**
 * 目录分组一次性注册（启动期脚手架）。
 *
 * 为什么只做一次：如果每次启动都把新出现的目录注册成分组，用户删掉的分组会
 * 反复复活、自动生成目录会让侧栏无限膨胀（参考 zcode v3.14.3 的
 * `__zcode_internal_grouped_workspace_bootstrap_once__` 教训）。本类的做法是：
 *
 * - 首次启动扫描历史 `workspace_key`，把**合格**目录注册成 `project_groups` 行；
 * - 写入 `_bootstrap.project_groups_bootstrapped_at` 后永不再扫；
 * - 之后的分组只来自「新建会话时写时注册」这一条明确路径；
 * - 自动生成目录 / `<baseDir>/public` 从不注册，因此天然落进「通用」桶。
 *
 * 幂等：`path_key` UNIQUE + `INSERT OR IGNORE`，重复执行不会覆盖用户改过的名字。
 */
@Injectable()
export class ProjectGroupBootstrapService {
  private readonly logger = new Logger(ProjectGroupBootstrapService.name);

  constructor(private readonly workspaceService: WorkspaceService) {}

  async run(): Promise<void> {
    const dir = resolveSessionsBasePath();
    let db: Database.Database | null = null;
    try {
      // openMetaDb 内部完成 v6 迁移与 workspace_key 回填，扫描结果即可用
      db = openMetaDb(dir);
      const baseDir = await this.workspaceService.getEffectiveBaseDir();

      // 每次启动都收敛「策略失效」的分组（public / 自动生成目录）。
      // 必须在 marker 门控之前：否则老库里已注册的历史 public 分组永远清不掉。
      this.reconcileInvalidGroups(db, baseDir);

      if (this.isBootstrapped(db)) return;

      // 只为「侧栏可见」的会话注册目录：已归档会话不产生分组，避免点开就是
      // 「暂无任务」的空分组（置顶会话仍计入——取消置顶后分组立即有内容）。
      const rows = db
        .prepare(
          `SELECT s.workspace_key AS pathKey,
                  (SELECT s2.workspace_path FROM sessions s2
                    WHERE s2.workspace_key = s.workspace_key
                      AND s2.workspace_path IS NOT NULL
                    ORDER BY COALESCE(s2.last_active_at, s2.updated_at, s2.created_at) DESC,
                             s2.id ASC
                    LIMIT 1) AS path,
                  MAX(COALESCE(s.last_active_at, s.updated_at, s.created_at)) AS lastActive
             FROM sessions s
            WHERE s.workspace_key IS NOT NULL
              AND s.session_type = 'web'
              AND s.archived = 0
            GROUP BY s.workspace_key
            ORDER BY lastActive DESC`,
        )
        .all() as { pathKey: string; path: string | null; lastActive: string | null }[];

      const now = new Date().toISOString();
      const insert = db.prepare(
        `INSERT OR IGNORE INTO project_groups
           (id, path, path_key, name, name_overridden, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      );
      const mark = db.prepare(
        `INSERT OR REPLACE INTO _bootstrap (key, value) VALUES (?, ?)`,
      );

      let created = 0;
      const tx = db.transaction(() => {
        // 按最近活跃排序，position 即该顺序（后续由用户拖拽改写）
        let position = 0;
        for (const row of rows) {
          if (!row.path || !qualifiesForProjectGroup(row.path, baseDir)) continue;
          const result = insert.run(
            mintId(ID_PREFIXES.projectGroup),
            row.path,
            row.pathKey,
            workspaceBasename(row.path) || row.path,
            position,
            now,
            now,
          );
          // 已存在同 path_key 时 position 不递增，保持既有分组顺序连续
          if (result.changes > 0) {
            created += 1;
            position += 1;
          }
        }
        mark.run(PROJECT_GROUPS_BOOTSTRAPPED_KEY, now);
      });
      tx();

      this.logger.log(
        `Directory groups bootstrapped: ${created} created from ${rows.length} workspace key(s)`,
      );
    } catch (err) {
      // 不落 marker：下次启动重试（幂等）
      this.logger.error(`目录分组注册失败: ${String(err)}`);
      throw err;
    } finally {
      db?.close();
    }
  }

  private isBootstrapped(db: Database.Database): boolean {
    const row = db
      .prepare(`SELECT value FROM _bootstrap WHERE key = ?`)
      .get(PROJECT_GROUPS_BOOTSTRAPPED_KEY) as { value: string | null } | undefined;
    return !!row?.value;
  }

  /**
   * 清理策略失效的分组行（public / 自动生成目录）。
   *
   * 只删 `name_overridden = 0` 的行：用户改过名是显式意图，不能因为判定规则
   * 收紧而静默丢弃。删除后该目录的会话自动回落到「通用」（成员关系是派生的），
   * 不触碰任何会话或磁盘文件。
   */
  private reconcileInvalidGroups(
    db: Database.Database,
    baseDir: string,
  ): void {
    const rows = db
      .prepare(`SELECT id, path FROM project_groups WHERE name_overridden = 0`)
      .all() as { id: string; path: string }[];
    const stale = rows.filter(
      (row) => !qualifiesForProjectGroup(row.path, baseDir),
    );
    if (stale.length === 0) return;

    const del = db.prepare(`DELETE FROM project_groups WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const row of stale) del.run(row.id);
    });
    tx();
    this.logger.log(
      `Removed ${stale.length} project group(s) that no longer qualify: ` +
        stale.map((row) => row.path).join(", "),
    );
  }
}
