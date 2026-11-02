/**
 * SQLite 分组驱动（会话分组 + 目录分组，实现 `SessionGroupPort` / `ProjectGroupPort`）
 *
 * 两个域共用同一个 `_meta.db` 连接（会话分组与目录分组本来就同库），
 * 但对外是两个独立端口——语义差异（删分组是否回写会话）在实现里显式处理。
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';

import { resolveSessionsBasePath } from '../../../utils/session-path.util';
import { mintId } from '../../../persistence/file-store-kit';
import { ID_PREFIXES } from '../../../utils/id.util';
import {
  normalizeWorkspaceKey,
  workspaceBasename,
} from '../../../utils/workspace-key.util';
import type { ProjectGroupPort, SessionGroupPort } from '../../ports/group.port';
import type {
  ProjectGroupCandidate,
  ProjectGroupRow,
  SessionGroupRow,
} from '../../ports/types';
import {
  PROJECT_GROUPS_BOOTSTRAPPED_KEY,
  groupDataJson,
  openMetaDb,
  projectGroupFromRow,
  sessionGroupFromRow,
} from './meta-schema';

@Injectable()
export class SqliteGroupDriver
  implements SessionGroupPort, ProjectGroupPort, OnModuleDestroy
{
  private readonly logger = new Logger(SqliteGroupDriver.name);
  private db: Database.Database | null = null;

  onModuleDestroy(): void {
    this.db?.close();
    this.db = null;
  }

  /** 懒开库：schema 迁移由 meta 驱动的 startup 负责，这里只取连接 */
  private ensureDb(): Database.Database {
    this.db ??= openMetaDb(resolveSessionsBasePath());
    return this.db;
  }

  // ============ 会话分组（session_groups） ============

  async list(): Promise<SessionGroupRow[]> {
    const rows = this.ensureDb()
      .prepare(
        `SELECT id, name, sort_order, icon, created_at, updated_at, data FROM session_groups ORDER BY sort_order ASC, id ASC`,
      )
      .all() as any[];
    return rows.map(sessionGroupFromRow);
  }

  async findById(id: string): Promise<SessionGroupRow | null> {
    const groups = await this.list();
    return groups.find((g) => g.id === id) ?? null;
  }

  /** 新建分组（id 为 grp-<uuid>） */
  async create(input: {
    name: string;
    sortOrder?: number;
    icon?: string | null;
    data?: Record<string, any> | null;
  }): Promise<SessionGroupRow> {
    const now = new Date().toISOString();
    const group: SessionGroupRow = {
      id: mintId(ID_PREFIXES.group),
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
      icon: input.icon ?? null,
      createdAt: now,
      updatedAt: now,
      data: input.data ?? null,
    };
    this.ensureDb()
      .prepare(
        `INSERT INTO session_groups (id, name, sort_order, icon, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        group.id,
        group.name,
        group.sortOrder,
        group.icon,
        group.createdAt,
        group.updatedAt,
        groupDataJson(group),
      );
    return group;
  }

  async update(
    id: string,
    patch: Partial<Pick<SessionGroupRow, 'name' | 'sortOrder' | 'icon' | 'data'>>,
  ): Promise<SessionGroupRow | null> {
    const target = await this.findById(id);
    if (!target) return null;
    const name = patch.name !== undefined ? patch.name : target.name;
    const sortOrder =
      patch.sortOrder !== undefined ? patch.sortOrder : target.sortOrder;
    const icon = patch.icon !== undefined ? patch.icon : target.icon;
    const groupData =
      patch.data !== undefined
        ? isRecord(patch.data)
          ? patch.data
          : null
        : (target.data ?? null);
    const updatedAt = new Date().toISOString();
    this.ensureDb()
      .prepare(
        `UPDATE session_groups SET name = ?, sort_order = ?, icon = ?, updated_at = ?, data = ? WHERE id = ?`,
      )
      .run(
        name,
        sortOrder,
        icon,
        updatedAt,
        groupData ? JSON.stringify(groupData) : null,
        id,
      );
    return { ...target, name, sortOrder, icon, updatedAt, data: groupData };
  }

  /** 删除分组：连同该组会话解绑（单事务，替代 FK onDelete SetNull） */
  async delete(id: string): Promise<{ id: string }> {
    const db = this.ensureDb();
    const tx = db.transaction((groupId: string) => {
      db.prepare(`DELETE FROM session_groups WHERE id = ?`).run(groupId);
      db.prepare(
        `UPDATE sessions SET group_id = NULL, updated_at = ? WHERE group_id = ?`,
      ).run(new Date().toISOString(), groupId);
    });
    tx(id);
    return { id };
  }

  /** 当前最大 sortOrder（新建分组排在最后） */
  async getMaxSortOrder(): Promise<number> {
    const row = this.ensureDb()
      .prepare(`SELECT MAX(sort_order) AS max FROM session_groups`)
      .get() as { max: number | null };
    return row.max ?? 0;
  }

  /** 批量更新分组排序（单事务） */
  async batchUpdateSortOrder(
    updates: Array<{ id: string; sortOrder: number }>,
  ): Promise<SessionGroupRow[]> {
    const db = this.ensureDb();
    const map = new Map(updates.map((u) => [u.id, u.sortOrder]));
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      const update = db.prepare(
        `UPDATE session_groups SET sort_order = ?, updated_at = ? WHERE id = ?`,
      );
      for (const [id, sortOrder] of map) {
        update.run(sortOrder, now, id);
      }
    });
    tx();
    const all = await this.list();
    return all.filter((g) => map.has(g.id));
  }

  // ============ 目录分组（project_groups） ============
  //
  // 成员关系是派生的：`sessions.workspace_key = project_groups.path_key`。
  // 因此这里没有成员表，删分组也不需要回写会话——会话自动回落到「通用」桶。

  /** 目录分组列表（按 position 升序；tiebreak 用 id 保证翻页/渲染稳定） */
  async listProjectGroups(): Promise<ProjectGroupRow[]> {
    const rows = this.ensureDb()
      .prepare(
        `SELECT id, path, path_key, name, name_overridden, icon, position, created_at, updated_at
         FROM project_groups ORDER BY position ASC, id ASC`,
      )
      .all() as any[];
    return rows.map(projectGroupFromRow);
  }

  async findProjectGroup(id: string): Promise<ProjectGroupRow | null> {
    const row = this.ensureDb()
      .prepare(
        `SELECT id, path, path_key, name, name_overridden, icon, position, created_at, updated_at
         FROM project_groups WHERE id = ?`,
      )
      .get(id) as any;
    return row ? projectGroupFromRow(row) : null;
  }

  async findProjectGroupByKey(pathKey: string): Promise<ProjectGroupRow | null> {
    const row = this.ensureDb()
      .prepare(
        `SELECT id, path, path_key, name, name_overridden, icon, position, created_at, updated_at
         FROM project_groups WHERE path_key = ?`,
      )
      .get(pathKey) as any;
    return row ? projectGroupFromRow(row) : null;
  }

  /**
   * 注册目录（幂等）：同 `path_key` 已存在时原样返回，**不覆盖**用户改过的名字。
   *
   * position 缺省：`prepend !== false` 时插到最前（新建会话/手动注册），
   * 否则排到末尾（bootstrap 会显式传 position）。
   */
  async ensureProjectGroup(input: {
    path: string;
    pathKey?: string;
    name?: string;
    position?: number;
    prepend?: boolean;
  }): Promise<ProjectGroupRow> {
    const db = this.ensureDb();
    const pathKey = input.pathKey ?? normalizeWorkspaceKey(input.path);
    const existing = await this.findProjectGroupByKey(pathKey);
    if (existing) return existing;

    let position = input.position;
    if (position === undefined) {
      if (input.prepend === false) {
        const row = db.prepare(`SELECT MAX(position) AS max FROM project_groups`).get() as {
          max: number | null;
        };
        position = (row.max ?? 0) + 1;
      } else {
        const row = db.prepare(`SELECT MIN(position) AS min FROM project_groups`).get() as {
          min: number | null;
        };
        position = (row.min ?? 1) - 1;
      }
    }

    const now = new Date().toISOString();
    const group: ProjectGroupRow = {
      id: mintId(ID_PREFIXES.projectGroup),
      path: input.path,
      pathKey,
      name: input.name?.trim() || workspaceBasename(input.path) || input.path,
      nameOverridden: false,
      icon: null,
      position,
      createdAt: now,
      updatedAt: now,
    };
    // OR IGNORE 兜住并发注册；零行变更说明已被抢先写入，读回既有行
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO project_groups
         (id, path, path_key, name, name_overridden, icon, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
      )
      .run(
        group.id,
        group.path,
        group.pathKey,
        group.name,
        group.position,
        group.createdAt,
        group.updatedAt,
      );
    if (result.changes === 0) {
      const raced = await this.findProjectGroupByKey(pathKey);
      if (raced) return raced;
    }
    return group;
  }

  /**
   * 更新显示名和/或图标。
   *
   * - 传 `name` 时写 `name_overridden = 1`（bootstrap 永不覆盖已改名分组）；
   * - 只传 `icon` 时不动 `name_overridden`，避免「换图标」被误判为用户改名；
   * - 两个字段都未传时返回 null。
   */
  async updateProjectGroup(
    id: string,
    patch: { name?: string; icon?: string | null },
  ): Promise<ProjectGroupRow | null> {
    const db = this.ensureDb();
    const target = await this.findProjectGroup(id);
    if (!target) return null;
    if (patch.name === undefined && patch.icon === undefined) return null;

    const trimmedName = patch.name !== undefined ? patch.name.trim() : target.name;
    if (!trimmedName) return null;
    const nameOverridden =
      patch.name !== undefined ? true : target.nameOverridden;
    const icon = patch.icon !== undefined ? patch.icon : target.icon;

    db.prepare(
      `UPDATE project_groups SET name = ?, name_overridden = ?, icon = ?, updated_at = ? WHERE id = ?`,
    ).run(
      trimmedName,
      nameOverridden ? 1 : 0,
      icon,
      new Date().toISOString(),
      id,
    );
    return this.findProjectGroup(id);
  }

  /** 拖拽排序：要求传入完整 id 集合（缺项/未知项直接拒绝，避免部分写入） */
  async reorderProjectGroups(ids: string[]): Promise<ProjectGroupRow[]> {
    const db = this.ensureDb();
    const all = await this.listProjectGroups();
    const known = new Set(all.map((g) => g.id));
    if (
      ids.length !== known.size ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !known.has(id))
    ) {
      throw new Error('目录分组排序：id 集合不完整或包含未知 id');
    }
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      const update = db.prepare(
        `UPDATE project_groups SET position = ?, updated_at = ? WHERE id = ?`,
      );
      ids.forEach((id, index) => update.run(index, now, id));
    });
    tx();
    return this.listProjectGroups();
  }

  /**
   * 取消注册：只删分组行，**不修改任何会话**。
   * 成员关系派生自 path_key，删行后该目录的会话自动回落到「通用」桶。
   */
  async deleteProjectGroup(id: string): Promise<{ id: string }> {
    this.ensureDb().prepare(`DELETE FROM project_groups WHERE id = ?`).run(id);
    return { id };
  }

  // ============ 启动期一次性注册 ============

  /**
   * 侧栏可见会话按工作目录归并出的候选目录。
   * 只为「侧栏可见」的会话注册目录：已归档会话不产生分组，避免点开就是
   * 「暂无任务」的空分组（置顶会话仍计入——取消置顶后分组立即有内容）。
   */
  async listGroupCandidates(): Promise<ProjectGroupCandidate[]> {
    const rows = this.ensureDb()
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
      .all() as ProjectGroupCandidate[];
    return rows;
  }

  async isBootstrapped(): Promise<boolean> {
    const row = this.ensureDb()
      .prepare(`SELECT value FROM _bootstrap WHERE key = ?`)
      .get(PROJECT_GROUPS_BOOTSTRAPPED_KEY) as { value: string | null } | undefined;
    return !!row?.value;
  }

  async markBootstrapped(at: string): Promise<void> {
    this.ensureDb()
      .prepare(`INSERT OR REPLACE INTO _bootstrap (key, value) VALUES (?, ?)`)
      .run(PROJECT_GROUPS_BOOTSTRAPPED_KEY, at);
  }

  /**
   * 清理策略失效的分组行（public / 自动生成目录）。
   *
   * 只删 `name_overridden = 0` 的行：用户改过名是显式意图，不能因为判定规则
   * 收紧而静默丢弃。删除后该目录的会话自动回落到「通用」（成员关系是派生的），
   * 不触碰任何会话或磁盘文件。
   *
   * 这是个人版启动脚手架的一部分，由 `ProjectGroupBootstrapService` 调用
   * （不属于端口契约——企业版没有「本地自动生成目录」概念）。
   */
  async reconcileInvalidGroups(
    isInvalid: (path: string) => boolean,
  ): Promise<number> {
    const db = this.ensureDb();
    const rows = db
      .prepare(`SELECT id, path FROM project_groups WHERE name_overridden = 0`)
      .all() as { id: string; path: string }[];
    const stale = rows.filter((row) => isInvalid(row.path));
    if (stale.length === 0) return 0;

    const del = db.prepare(`DELETE FROM project_groups WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const row of stale) del.run(row.id);
    });
    tx();
    this.logger.log(
      `Removed ${stale.length} project group(s) that no longer qualify: ` +
        stale.map((row) => row.path).join(', '),
    );
    return stale.length;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
