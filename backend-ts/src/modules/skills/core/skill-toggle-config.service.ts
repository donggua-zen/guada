/**
 * 技能开关的**统一持久化层**：全局与项目都走同一套 YAML 配置。
 *
 * ```
 * 全局：<SETTINGS_DIR>/skills.yaml              （与 account.json / models.json 同目录）
 * 项目：<项目>/.guada/skills.yaml
 * ```
 *
 * 两者格式完全一致，只有作用域不同：
 *
 * ```yaml
 * disabled:
 *   - some-skill
 * ```
 *
 * 语义（见 docs/skills.md「技能开关」）：
 * - 只记录「被关掉」的技能 id，不在列表里 = 默认启用；
 * - 用**列表**而非 `id: false` 映射，从格式上就无法表达「启用」——
 *   这让「项目只能收紧不能放宽」成为结构上的保证，而不是靠代码约定；
 * - 空列表时删除文件（不留 `disabled: []` 噪音）。
 *
 * 迁移：旧版全局开关散落在 `plugins.json` 的 `skills.<id>` 键里（21 个左右
 * 的私有字段），启动时一次性搬到 `skills.yaml` 并从 plugins.json 移除。
 *
 * 热路径：`listSkills()` 在 prompt 构建时同步读，故用 `statSync` + mtime/size
 * 缓存（照 policy-rules.service.ts 的做法），不挂 watcher。
 */
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import { atomicWriteFile } from "../../../common/persistence/file-store-kit";
import { normalizeWorkspaceKey } from "../../../common/utils/workspace-key.util";
import { SettingsStorage } from "../../../common/utils/settings-storage.util";

const PROJECT_SKILLS_CONFIG_RELATIVE = path.join(".guada", "skills.yaml");
const GLOBAL_SKILLS_CONFIG_FILE = "skills.yaml";
/** 旧版全局开关在 plugins.json 里的键前缀 */
const LEGACY_PLUGINS_KEY_PREFIX = "skills.";
/** 单文件体积上限：技能 id 列表不该超过这个量级，超出视为异常文件 */
const MAX_CONFIG_BYTES = 512 * 1024;
/** 与 skill id 的合法形态一致 */
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export interface SkillToggleConfig {
  /** 配置文件绝对路径 */
  file: string;
  /** 在该作用域内被禁用的技能 id（已排序） */
  disabled: string[];
  /** 读取时发现的问题（前端黄条提示；不影响 disabled 生效） */
  warnings: string[];
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  disabled: ReadonlySet<string>;
}

const EMPTY_SET: ReadonlySet<string> = Object.freeze(
  new Set<string>(),
) as ReadonlySet<string>;

@Injectable()
export class SkillToggleConfigService implements OnModuleInit {
  private readonly logger = new Logger(SkillToggleConfigService.name);
  /** 键 = 配置文件绝对路径（项目侧用归一化路径，`D:\a` 与 `d:/a/` 同键） */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly configService: ConfigService,
    private readonly settingsStorage: SettingsStorage,
  ) {}

  /**
   * 启动迁移：把 plugins.json 里的 `skills.<id>` 私有字段搬到 skills.yaml。
   *
   * 幂等：skills.yaml 已存在时不再迁移（用户可能已手工编辑）；
   * 失败只 warn，不影响启动。
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.migrateLegacyPluginsKeys();
    } catch (e: any) {
      this.logger.warn(`skills config migration failed: ${e?.message ?? e}`);
    }
  }

  /** 全局配置文件路径 */
  globalFilePath(): string {
    const dir =
      this.configService.get<string>("SETTINGS_DIR") ||
      this.configService.get<string>("USERDATA_DIR") ||
      path.join(os.homedir(), ".guada");
    return path.join(dir, GLOBAL_SKILLS_CONFIG_FILE);
  }

  /** 项目配置文件路径；无项目路径时 null */
  projectFilePath(projectPath?: string | null): string | null {
    const ws = (projectPath || "").trim();
    if (!ws) return null;
    return path.join(ws, PROJECT_SKILLS_CONFIG_RELATIVE);
  }

  // ─────────────────────────── 读取 ───────────────────────────

  /** 热路径：同步取全局被禁用的技能 id */
  getGlobalDisabledIds(): ReadonlySet<string> {
    return this.readDisabledSync(this.globalFilePath());
  }

  /** 热路径：同步取某项目被禁用的技能 id */
  getProjectDisabledIds(projectPath?: string | null): ReadonlySet<string> {
    const file = this.projectFilePath(projectPath);
    return file ? this.readDisabledSync(file) : EMPTY_SET;
  }

  /** 单个技能是否在全局被禁用 */
  isGlobalDisabled(skillId: string): boolean {
    if (!skillId) return false;
    return this.getGlobalDisabledIds().has(skillId.toLowerCase());
  }

  /** 单个技能是否在该项目被禁用 */
  isProjectDisabled(projectPath: string | null | undefined, skillId: string): boolean {
    if (!skillId) return false;
    return this.getProjectDisabledIds(projectPath).has(skillId.toLowerCase());
  }

  /** 全局配置的完整视图 */
  readGlobal(): SkillToggleConfig {
    return this.buildView(this.globalFilePath());
  }

  /** 项目配置的完整视图 */
  readProject(projectPath: string): SkillToggleConfig {
    const file = this.projectFilePath(projectPath) as string;
    return this.buildView(file);
  }

  // ─────────────────────────── 写入 ───────────────────────────

  /**
   * 设置某技能在全局的启用状态。
   *
   * @param enabled true = 从禁用列表移除（默认启用）；false = 加入禁用列表
   */
  async setGlobalEnabled(skillId: string, enabled: boolean): Promise<SkillToggleConfig> {
    const file = this.globalFilePath();
    return await this.setDisabledInFile(file, skillId, !enabled);
  }

  /**
   * 设置某技能在某项目的启用状态。
   *
   * `enabled=true` 的语义是「恢复继承全局状态」，不是「强制启用」。
   */
  async setProjectEnabled(
    projectPath: string,
    skillId: string,
    enabled: boolean,
  ): Promise<SkillToggleConfig> {
    const file = this.projectFilePath(projectPath);
    if (!file) {
      throw new Error("项目级技能开关需要项目目录，但当前没有关联项目");
    }
    return await this.setDisabledInFile(file, skillId, !enabled);
  }

  /** 清空缓存（测试用 / 迁移后强制重读） */
  clearCache(): void {
    this.cache.clear();
  }

  // ─────────────────────────── 内部 ───────────────────────────

  private async setDisabledInFile(
    file: string,
    skillId: string,
    disabled: boolean,
  ): Promise<SkillToggleConfig> {
    const id = String(skillId || "").trim().toLowerCase();
    if (!SKILL_ID_PATTERN.test(id)) {
      throw new Error(`非法的技能 id：${skillId}`);
    }

    // 读现状（绕开缓存直接读盘，避免用陈旧内容整表覆盖用户的并发编辑）
    const current = this.readDisabledFromDisk(file);
    const next = new Set(current);
    if (disabled) next.add(id);
    else next.delete(id);

    await this.writeDisabled(file, next);
    this.cache.delete(this.cacheKey(file));
    return this.buildView(file);
  }

  private buildView(file: string): SkillToggleConfig {
    const warnings: string[] = [];
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_CONFIG_BYTES) {
        warnings.push(`配置文件过大（>${MAX_CONFIG_BYTES} 字节），已忽略其内容`);
      }
    } catch {
      // 不存在：不算告警
    }
    return {
      file,
      disabled: Array.from(this.readDisabledSync(file)).sort((a, b) =>
        a.localeCompare(b),
      ),
      warnings,
    };
  }

  /** 缓存键：项目路径归一化，避免 `D:\a` 与 `d:/a/` 裂成两份 */
  private cacheKey(file: string): string {
    return normalizeWorkspaceKey(file);
  }

  /**
   * 同步读禁用集合（mtime + size 缓存）。
   *
   * 文件缺失 / stat 失败 / 解析失败 / 结构不合法 → 空集合。
   * 配置坏了不该让技能清单整段消失。
   */
  private readDisabledSync(file: string): ReadonlySet<string> {
    const key = this.cacheKey(file);

    let mtimeMs = -1;
    let size = -1;
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) return EMPTY_SET;
      mtimeMs = st.mtimeMs;
      size = st.size;
    } catch {
      this.cache.delete(key);
      return EMPTY_SET;
    }

    const cached = this.cache.get(key);
    // mtime + size 双字段：Windows 上两次紧邻写入可能拿到同一 mtimeMs
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      return cached.disabled;
    }

    let disabled: ReadonlySet<string> = EMPTY_SET;
    try {
      if (size <= MAX_CONFIG_BYTES) {
        disabled = this.parseDisabled(fs.readFileSync(file, "utf-8"));
      }
    } catch (e: any) {
      this.logger.warn(`skill config unreadable, ignoring: ${file} (${e?.message ?? e})`);
    }
    this.cache.set(key, { mtimeMs, size, disabled });
    return disabled;
  }

  /** 直接读盘（不查缓存），用于「读-改-写」 */
  private readDisabledFromDisk(file: string): string[] {
    try {
      if (!fs.statSync(file).isFile()) return [];
      return Array.from(this.parseDisabled(fs.readFileSync(file, "utf-8")));
    } catch {
      return [];
    }
  }

  /**
   * 解析 YAML：只认 `disabled` 字符串数组，其余字段忽略。
   *
   * 逐项过滤而不是整体拒绝：一个坏条目不该让整份配置失效。
   */
  private parseDisabled(raw: string): ReadonlySet<string> {
    let doc: unknown;
    try {
      doc = yaml.load(raw);
    } catch (e: any) {
      this.logger.warn(`skill config YAML invalid: ${e?.message ?? e}`);
      return EMPTY_SET;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return EMPTY_SET;

    const list = (doc as Record<string, unknown>).disabled;
    if (!Array.isArray(list)) return EMPTY_SET;

    const ids = new Set<string>();
    for (const item of list) {
      if (typeof item !== "string") continue;
      const id = item.trim().toLowerCase();
      if (!id || !SKILL_ID_PATTERN.test(id)) continue;
      ids.add(id);
    }
    return ids;
  }

  /** 原子写；空列表时删除文件 */
  private async writeDisabled(file: string, ids: Set<string>): Promise<void> {
    if (ids.size === 0) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* 不存在即视为成功 */
      }
      return;
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sorted = Array.from(ids).sort((a, b) => a.localeCompare(b));
    const header = [
      "# 技能开关（全局：对所有项目生效；项目级配置在 <项目>/.guada/skills.yaml）",
      "# - 列表中的技能被禁用；不在列表里 = 默认启用",
      "# - 只能禁用不能在此强制启用：启用 = 从列表移除",
      "",
    ].join("\n");
    const content = header + yaml.dump({ disabled: sorted }, { lineWidth: -1, noRefs: true });
    await atomicWriteFile(file, content);
  }

  /**
   * 迁移旧版全局开关：`plugins.json` 的 `skills.<id> = false` → `skills.yaml`。
   *
   * 只搬 `false`（禁用）；`true` 是默认态，搬过去也只会多一条噪音。
   * 迁移后从 plugins.json 删除这些键，避免两份真相并存。
   */
  private async migrateLegacyPluginsKeys(): Promise<void> {
    const globalFile = this.globalFilePath();
    if (fs.existsSync(globalFile)) {
      // 已经是新格式：不再重复迁移（用户可能手工编辑过，不能被覆盖）
      return;
    }

    const plugins = (await this.settingsStorage.getSettings("plugins")) || {};
    const legacyDisabled: string[] = [];
    const legacyKeys: string[] = [];
    for (const [key, value] of Object.entries(plugins)) {
      if (!key.startsWith(LEGACY_PLUGINS_KEY_PREFIX)) continue;
      legacyKeys.push(key);
      const id = key.slice(LEGACY_PLUGINS_KEY_PREFIX.length);
      if (value === false && SKILL_ID_PATTERN.test(id)) legacyDisabled.push(id);
    }

    if (legacyKeys.length === 0) return;

    if (legacyDisabled.length > 0) {
      fs.mkdirSync(path.dirname(globalFile), { recursive: true });
      await this.writeDisabled(globalFile, new Set(legacyDisabled));
      this.cache.delete(this.cacheKey(globalFile));
    }

    // 从 plugins.json 移除旧键：统一后的唯一真相是 skills.yaml。
    // 注意不能用 updateSettings（它是 Object.assign，删不掉键），
    // 必须逐个 deleteSettingValue，否则下次启动会看到同一批键仍然存在。
    for (const key of legacyKeys) {
      await this.settingsStorage.deleteSettingValue("plugins", key);
    }

    this.logger.log(
      `Migrated ${legacyKeys.length} legacy skill toggles to ${globalFile} ` +
        `(${legacyDisabled.length} disabled)`,
    );
  }
}
