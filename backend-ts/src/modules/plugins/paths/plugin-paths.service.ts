import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * 插件数据目录（v2）
 *
 * 三方插件除了插件安装目录（只读）之外，还需要一个可写目录来放：
 * - prompt-inject.md（用户编辑的人格/注入文本）
 * - rules/*.md（规则集）
 * - state.json / snapshots（应用与回滚）
 *
 * 约定：`$USERDATA_DIR/plugins-data/<pluginId>/`
 * - 目录按需创建；
 * - pluginId 严格校验，且 realpath 后必须仍在根内（防目录穿越）。
 */
@Injectable()
export class PluginPathsService {
  private readonly logger = new Logger(PluginPathsService.name);

  constructor(@Optional() private readonly configService?: ConfigService) {}

  private baseRoot(): string {
    const configured =
      this.configService?.get<string>("USERDATA_DIR") ||
      this.configService?.get<string>("SETTINGS_DIR");
    const base = configured || path.join(os.homedir(), ".guada");
    return path.resolve(base, "plugins-data");
  }

  /** 返回（并创建）插件数据目录 */
  getDataDir(pluginId: string): string {
    if (!pluginId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pluginId)) {
      throw new Error(`invalid plugin id: ${pluginId}`);
    }
    const root = this.baseRoot();
    const dir = path.resolve(root, pluginId);
    const rel = path.relative(root, dir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`plugin data dir escapes root: ${pluginId}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** 只读查询：不创建目录 */
  peekDataDir(pluginId: string): string {
    return path.resolve(this.baseRoot(), pluginId);
  }

  /** 删除插件数据目录（卸载时由插件自行决定是否调用） */
  removeDataDir(pluginId: string): void {
    const dir = this.peekDataDir(pluginId);
    const root = this.baseRoot();
    const rel = path.relative(root, dir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err: any) {
      this.logger.warn(`remove plugin data dir failed: ${pluginId}: ${err?.message ?? err}`);
    }
  }
}
