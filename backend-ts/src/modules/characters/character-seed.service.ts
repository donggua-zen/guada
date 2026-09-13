import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  CharacterFileStore,
  resolveBundledAgentsDir,
} from "./character-file.store";
import { isValidAgentId } from "./character-file.mapper";

/**
 * 默认助手补种
 *
 * `bundled-agents/<id>/` 是随包发布的只读默认助手模板（同 bundled-providers 的定位）。
 * 启动时对「用户根缺失且无墓碑」的默认 id 执行复制补种：
 * - 已存在绝不覆盖 → 用户改过的助手不会被冲掉
 * - 有墓碑（UI 主动删除）不复活 → 有意删除被尊重
 * - 文件管理器误删（无墓碑）→ 自动恢复默认版本
 */
@Injectable()
export class CharacterSeedService implements OnModuleInit {
  private readonly logger = new Logger(CharacterSeedService.name);

  constructor(private readonly store: CharacterFileStore) {}

  async onModuleInit(): Promise<void> {
    await this.store.initialize();
    await this.seedBundledDefaults();
  }

  private async seedBundledDefaults(): Promise<void> {
    const bundledDir = resolveBundledAgentsDir();
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(bundledDir, { withFileTypes: true });
    } catch {
      return; // 无 bundled 模板（开发/精简包），无需补种
    }

    const tombstones = await this.store.readTombstones();
    const existing = new Set(
      (await this.store.listCharacters()).map((c) => c.id.toLowerCase()),
    );

    let seeded = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const id = entry.name;
      if (!isValidAgentId(id)) continue;
      if (existing.has(id.toLowerCase())) continue;
      if (tombstones.has(id)) continue;
      try {
        await copyDir(
          path.join(bundledDir, id),
          path.join(this.store.getDirectory(), id),
        );
        seeded++;
      } catch (err) {
        this.logger.warn(`补种默认助手失败 ${id}: ${String(err)}`);
      }
    }

    if (seeded > 0) {
      await this.store.reload();
      this.logger.log(`已补种 ${seeded} 个默认助手`);
    }
  }
}

/** 递归复制目录（Node 16.7+ 用 fs.cp，缺失时手工回退） */
async function copyDir(src: string, dest: string): Promise<void> {
  const anyFs = fs as unknown as { cp?: (...args: any[]) => Promise<void> };
  if (typeof anyFs.cp === "function") {
    await anyFs.cp(src, dest, { recursive: true });
    return;
  }
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}
