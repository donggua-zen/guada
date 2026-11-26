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
 * skills:
 *   browser-script: false   # 关掉
 *   weread-skills: true     # 显式启用（项目可覆盖全局的 false）
 * ```
 *
 * 语义（见 docs/skills.md「技能开关」）：
 * - **覆盖表**：键存在即覆盖上层状态；键不存在 = 继承上层；
 * - 全局是顶层：继承落空时默认启用；
 * - 项目可双向覆盖全局（既能关掉也能打开），优先级 项目 > 全局 > 默认启用；
 * - 空表时删除文件（不留 `skills: {}` 噪音）。
 *
 * 兼容旧格式：解析同时接受 `disabled: [...]`（等价于 `skills: {id: false}`），
 * 写入一律产出新格式——首次切换即完成该文件迁移。
 *
 * 历史：更早的全局开关散落在 `plugins.json` 的 `skills.<id>` 键里，
 * 启动时一次性搬到 `skills.yaml` 并从 plugins.json 移除。
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
  /**
   * 该作用域的显式覆盖：`{ '<skill-id>': boolean }`。
   * 键不存在 = 继承上层（全局的上层是「默认启用」）。
   */
  overrides: Record<string, boolean>;
  /** 读取时发现的问题（前端黄条提示；不影响 overrides 生效） */
  warnings: string[];
}

type OverrideMap = ReadonlyMap<string, boolean>;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  overrides: OverrideMap;
}

const EMPTY_MAP: OverrideMap = Object.freeze(new Map<string, boolean>()) as OverrideMap;

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

  /** 热路径：同步取全局覆盖表 */
  getGlobalOverrides(): OverrideMap {
    return this.readOverridesSync(this.globalFilePath());
  }

  /** 热路径：同步取某项目覆盖表 */
  getProjectOverrides(projectPath?: string | null): OverrideMap {
    const file = this.projectFilePath(projectPath);
    return file ? this.readOverridesSync(file) : EMPTY_MAP;
  }

  /**
   * 全局对某技能的显式覆盖。
   * @returns undefined = 未覆盖（默认启用）；true/false = 显式指定
   */
  getGlobalOverride(skillId: string): boolean | undefined {
    if (!skillId) return undefined;
    return this.getGlobalOverrides().get(skillId.toLowerCase());
  }

  /** 项目对某技能的显式覆盖；undefined = 继承全局 */
  getProjectOverride(
    projectPath: string | null | undefined,
    skillId: string,
  ): boolean | undefined {
    if (!skillId) return undefined;
    return this.getProjectOverrides(projectPath).get(skillId.toLowerCase());
  }

  /** 全局视图 */
  readGlobal(): SkillToggleConfig {
    return this.buildView(this.globalFilePath());
  }

  /** 项目视图 */
  readProject(projectPath: string): SkillToggleConfig {
    return this.buildView(this.projectFilePath(projectPath) as string);
  }

  // ─────────────────────────── 写入 ───────────────────────────

  /**
   * 设置某技能在全局的启用状态。
   *
   * `enabled=true` 是默认态 → 删除覆盖（不留 `id: true` 噪音）；
   * `enabled=false` → 写入显式 `false`。
   */
  async setGlobalEnabled(
    skillId: string,
    enabled: boolean,
  ): Promise<SkillToggleConfig> {
    const file = this.globalFilePath();
    return await this.setOverrideInFile(file, skillId, enabled ? undefined : false);
  }

  /**
   * 设置某技能在某项目的覆盖。
   *
   * @param enabled `true`/`false` = 显式覆盖全局；`undefined` = 删除覆盖（回到继承）
   */
  async setProjectOverride(
    projectPath: string,
    skillId: string,
    enabled: boolean | undefined,
  ): Promise<SkillToggleConfig> {
    const file = this.projectFilePath(projectPath);
    if (!file) {
      throw new Error("项目级技能开关需要项目目录，但当前没有关联项目");
    }
    return await this.setOverrideInFile(file, skillId, enabled);
  }

  /** 清空缓存（测试用 / 迁移后强制重读） */
  clearCache(): void {
    this.cache.clear();
  }

  // ─────────────────────────── 内部 ───────────────────────────

  /**
   * 写入单个覆盖。
   *
   * @param value undefined = 删除该键（回到继承）
   */
  private async setOverrideInFile(
    file: string,
    skillId: string,
    value: boolean | undefined,
  ): Promise<SkillToggleConfig> {
    const id = String(skillId || "").trim().toLowerCase();
    if (!SKILL_ID_PATTERN.test(id)) {
      throw new Error(`非法的技能 id：${skillId}`);
    }

    // 读现状（绕开缓存直接读盘，避免用陈旧内容整表覆盖用户的并发编辑）
    const current = this.readOverridesFromDisk(file);
    const next = new Map(current);
    if (value === undefined) next.delete(id);
    else next.set(id, value);

    await this.writeOverrides(file, next);
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
    const map = this.readOverridesSync(file);
    const sorted: Record<string, boolean> = {};
    for (const id of Array.from(map.keys()).sort((a, b) => a.localeCompare(b))) {
      sorted[id] = map.get(id) as boolean;
    }
    return { file, overrides: sorted, warnings };
  }

  /** 缓存键：路径归一化，避免 `D:\a` 与 `d:/a/` 裂成两份 */
  private cacheKey(file: string): string {
    return normalizeWorkspaceKey(file);
  }

  /**
   * 同步读覆盖表（mtime + size 缓存）。
   *
   * 文件缺失 / stat 失败 / 解析失败 / 结构不合法 → 空表（等于「全部继承」）。
   * 配置坏了不该让技能清单整段消失。
   */
  private readOverridesSync(file: string): OverrideMap {
    const key = this.cacheKey(file);

    let mtimeMs = -1;
    let size = -1;
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) return EMPTY_MAP;
      mtimeMs = st.mtimeMs;
      size = st.size;
    } catch {
      this.cache.delete(key);
      return EMPTY_MAP;
    }

    const cached = this.cache.get(key);
    // mtime + size 双字段：Windows 上两次紧邻写入可能拿到同一 mtimeMs
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      return cached.overrides;
    }

    let overrides: OverrideMap = EMPTY_MAP;
    try {
      if (size <= MAX_CONFIG_BYTES) {
        overrides = this.parseOverrides(fs.readFileSync(file, "utf-8"));
      }
    } catch (e: any) {
      this.logger.warn(`skill config unreadable, ignoring: ${file} (${e?.message ?? e})`);
    }
    this.cache.set(key, { mtimeMs, size, overrides });
    return overrides;
  }

  /** 直接读盘（不查缓存），用于「读-改-写」 */
  private readOverridesFromDisk(file: string): OverrideMap {
    try {
      if (!fs.statSync(file).isFile()) return EMPTY_MAP;
      return this.parseOverrides(fs.readFileSync(file, "utf-8"));
    } catch {
      return EMPTY_MAP;
    }
  }

  /**
   * 解析 YAML 覆盖表。
   *
   * 优先读 `skills` 映射；不存在时回退旧格式 `disabled: [...]`（等价于 `false`）。
   * 逐项过滤而不是整体拒绝：一个坏条目不该让整份配置失效。
   */
  private parseOverrides(raw: string): OverrideMap {
    let doc: unknown;
    try {
      doc = yaml.load(raw);
    } catch (e: any) {
      this.logger.warn(`skill config YAML invalid: ${e?.message ?? e}`);
      return EMPTY_MAP;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return EMPTY_MAP;

    const record = doc as Record<string, unknown>;
    const overrides = new Map<string, boolean>();

    const skills = record.skills;
    if (skills && typeof skills === "object" && !Array.isArray(skills)) {
      for (const [key, value] of Object.entries(skills as Record<string, unknown>)) {
        const id = key.trim().toLowerCase();
        if (!id || !SKILL_ID_PATTERN.test(id)) continue;
        if (typeof value !== "boolean") continue;
        overrides.set(id, value);
      }
      return overrides;
    }

    // 旧格式兼容：disabled 列表 → 全部视为 false
    const legacyDisabled = record.disabled;
    if (Array.isArray(legacyDisabled)) {
      for (const item of legacyDisabled) {
        if (typeof item !== "string") continue;
        const id = item.trim().toLowerCase();
        if (!id || !SKILL_ID_PATTERN.test(id)) continue;
        overrides.set(id, false);
      }
    }
    return overrides;
  }

  /** 原子写；空表时删除文件 */
  private async writeOverrides(file: string, overrides: Map<string, boolean>): Promise<void> {
    if (overrides.size === 0) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* 不存在即视为成功 */
      }
      return;
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    const sorted: Record<string, boolean> = {};
    for (const id of Array.from(overrides.keys()).sort((a, b) => a.localeCompare(b))) {
      sorted[id] = overrides.get(id) as boolean;
    }
    const header = [
      "# 技能开关（全局：对所有项目生效；项目级配置在 <项目>/.guada/skills.yaml）",
      "# - 键存在即覆盖上层状态；键不存在 = 继承上层",
      "# - 全局是顶层：继承落空时默认启用",
      "# - 项目可双向覆盖全局（false 关掉 / true 打开）",
      "",
    ].join("\n");
    const content = header + yaml.dump({ skills: sorted }, { lineWidth: -1, noRefs: true });
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
      const overrides = new Map<string, boolean>();
      for (const id of legacyDisabled) overrides.set(id, false);
      fs.mkdirSync(path.dirname(globalFile), { recursive: true });
      await this.writeOverrides(globalFile, overrides);
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
