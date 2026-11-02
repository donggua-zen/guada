/**
 * 文件系统会话资产驱动（实现 `SessionAssetPort`）
 *
 * **不使用 SQLite**：这是纯文件系统实现，只做会话资产容器的建/删/拷/列。
 * 放在 `drivers/fs/` 而非 `drivers/sqlite/`，是为了让「驱动 = 介质」这条
 * 对应关系不被命名误导（`_meta.db` 那套才是 sqlite 驱动）。
 *
 * ## 域边界：资产子目录白名单
 *
 * 会话目录里同时住着两个域的数据：
 *
 * ```
 * <sessionsBase>/<sessionId>/
 *   seg-0000.jsonl  manifest.json  snapshot.json   ← messages 域（事件日志驱动）
 *   images/  previews/  workflows/                 ← assets 域（本驱动）
 * ```
 *
 * 本驱动**只碰白名单里的资产子目录**，绝不 rm/cp 整个会话目录：
 * - 整目录 rm 会越权删除 messages 域的数据（企业版下那些文件属于另一个驱动）
 * - 整目录 cp 会把事件日志复制一份，而分支克隆本就用 `importEvents` 重放事件，
 *   重复日志会造成 seq 冲突
 *
 * 「删会话」的完整语义仍由上层编配保证：`SessionStoreFacade.deleteSession`
 * 删资产与行，随后 `SessionService` 调 `clearSessionTurns` 删日志目录。
 *
 * ## 内容读写不经本端口
 *
 * 当前拓扑（每台机器跑完整后端、附件仅本机可见）下，附件内容天然在本地盘，
 * 因此图片/附件的写入仍由 `SessionImageStore` / `FileService` /
 * `WorkflowFileStore` 直连文件系统。端口只覆盖**生命周期**是刻意取舍，
 * 不是遗漏——换成对象存储才需要把内容读写也纳入端口。
 */
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';

import { resolveSessionsBasePath } from '../../../utils/session-path.util';
import type { SessionAssetPort } from '../../ports/types';

/**
 * 资产子目录白名单（与 messages 域的 manifest/seg/snapshot 严格分开）。
 * `remove` 与 `copy` 共用，新增资产类型时只改这里。
 */
export const ASSET_SUBDIRS = ['images', 'previews', 'workflows'] as const;

@Injectable()
export class FsSessionAssetDriver implements SessionAssetPort {
  private readonly logger = new Logger(FsSessionAssetDriver.name);
  private readonly sessionsRoot = resolveSessionsBasePath();

  private sessionDir(sessionId: string): string {
    return path.join(this.sessionsRoot, sessionId);
  }

  async ensure(sessionId: string): Promise<void> {
    await fsp.mkdir(this.sessionDir(sessionId), { recursive: true });
  }

  async exists(sessionId: string): Promise<boolean> {
    return fs.existsSync(this.sessionDir(sessionId));
  }

  /**
   * 删除会话资产（幂等）。
   *
   * 只删白名单子目录，**不删同级的事件日志**（`seg-*.jsonl` / `manifest.json` /
   * `snapshot.json` 归 messages 驱动）。删除后若会话目录已空（没有任何剩余文件），
   * 顺带把空目录收掉——`rmdir` 在非空时必然失败，因此这一步不会误删轨迹数据。
   */
  async remove(sessionId: string): Promise<void> {
    const dir = this.sessionDir(sessionId);
    for (const name of ASSET_SUBDIRS) {
      await this.removeDirWithRetry(path.join(dir, name));
    }
    // 空目录兜底：事件日志还在时 rmdir 会失败（ENOTEMPTY），正好跳过
    await fsp.rmdir(dir).catch(() => undefined);
  }

  private async removeDirWithRetry(dir: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fsp.rm(dir, { recursive: true, force: true });
        return;
      } catch (err: any) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      }
    }
  }

  /**
   * 拷贝会话资产到另一个会话（分支/克隆用；源不存在静默跳过）。
   * 只拷白名单子目录——复制事件日志会让新会话出现重复 seq。
   */
  async copy(fromSessionId: string, toSessionId: string): Promise<void> {
    const from = this.sessionDir(fromSessionId);
    if (!fs.existsSync(from)) return;
    const to = this.sessionDir(toSessionId);
    await fsp.mkdir(to, { recursive: true });
    for (const name of ASSET_SUBDIRS) {
      const src = path.join(from, name);
      if (!fs.existsSync(src)) continue;
      await fsp.cp(src, path.join(to, name), { recursive: true });
    }
  }

  /** 列出会话目录的 id（资产可能存在也可能不存在；调用方自行用 exists 过滤） */
  async listIds(): Promise<string[]> {
    if (!fs.existsSync(this.sessionsRoot)) return [];
    const entries = await fsp.readdir(this.sessionsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  }
}
