/**
 * 命令策略配置：**出厂规则**（数据文件，随包分发）+ **用户文件**（只存你的改动）。
 *
 * 用户文件：`<SETTINGS_DIR>/policy.yaml`（与 account.json / models.json 同目录）
 *   rules:           一条有序规则表（命令规则 `{action, match}` / 路径规则 `{action, path}`）
 *   readOnlyRemove:  从出厂只读名单里划掉的条目
 * 项目级：`<workspace>/.guada/policy.yaml` 同 schema，**整体优先**于全局。
 *
 * 出厂规则不写进用户文件 → 新版本自动跟随；「重置」= 清空你的改动（覆盖前备份 .bak）。
 *
 * 热路径：`getEffectivePolicySync()` 用 mtime 缓存（每命令 ≤2 次 stat）。
 */

import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  builtinReadOnlySet,
  isAllowedPath,
  matchPathRule,
  loadFactoryPolicy,
  normalizeReadOnlyEntry,
  type EffectivePolicy,
  type FactoryPolicy,
  type PathRule,
  type PolicyRule,
  type RuleAction,
} from "./command-policy";
import { catastrophicPatternOf } from "./command-policy/workspace-rules";
import { expandPathPattern } from "./command-policy/path-glob";

/** 用户文件：只存改动 */
export interface PolicyUserFile {
  rules: PolicyRule[];
  readOnlyRemove: string[];
}

export type PolicyScope = "global" | "project";

/** API 返回：生效规则 + 出厂清单 + 文件路径 + 校验告警 */
export interface EffectivePolicyView {
  /** 你的规则 */
  userRules: PolicyRule[];
  /** 出厂规则（UI 标记"内置"用） */
  factoryRules: PolicyRule[];
  /** 出厂清单（分区的原始视图） */
  factory: FactoryPolicy;
  /** 你划掉的出厂只读条目 */
  readOnlyRemove: string[];
  /** 生效只读名单（出厂 − 划掉） */
  readOnlyEffective: string[];
  paths: { global: string; project: string | null };
  warnings: string[];
}

const MAX_RULE_LENGTH = 120;
const MAX_PATH_LENGTH = 260;
const MAX_RULE_TOKENS = 8;
/** 规则只是"token 前缀匹配器"，出现 shell 元字符说明用户把它当命令写了 */
const META_CHARS = /[;|&><`$()"'\\]/;
/** 通配一切：拒绝（等于关掉整个护栏） */
const BLANKET_RULE = /^\*+$/;
/** 整个 shell 的放行规则（内层不再判定）→ 告警 */
const SHELL_WIDE_RULE = /^(powershell|pwsh|cmd|(?:ba|z|da|k)?sh)(\s|\*|$)/i;
const ACTIONS: readonly RuleAction[] = ["allow", "ask", "deny"];

interface CacheEntry {
  mtimeMs: number;
  size: number;
  parsed: PolicyUserFile;
}

function emptyUserFile(): PolicyUserFile {
  return { rules: [], readOnlyRemove: [] };
}

@Injectable()
export class PolicyRulesService implements OnModuleInit {
  private readonly logger = new Logger(PolicyRulesService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly configService: ConfigService) {}

  /** 启动时把旧 schema（v1 平铺 / v2 物化）换算成 v3 增量，并备份 `.bak` */
  onModuleInit(): void {
    try {
      this.migrateLegacyFile(this.globalFilePath());
      const project = this.projectFilePathForMigration();
      if (project) this.migrateLegacyFile(project);
    } catch (e: any) {
      this.logger.warn(`policy migration failed: ${e?.message ?? e}`);
    }
  }

  /** 全局策略文件路径（与 account.json / models.json 同目录） */
  globalFilePath(): string {
    const dir =
      this.configService.get<string>("SETTINGS_DIR") ||
      this.configService.get<string>("USERDATA_DIR") ||
      path.join(os.homedir(), ".guada");
    return path.join(dir, "policy.yaml");
  }

  /** 项目级策略文件路径（无工作区则 null） */
  projectFilePath(workspacePath?: string | null): string | null {
    const ws = (workspacePath || "").trim();
    if (!ws) return null;
    return path.join(ws, ".guada", "policy.yaml");
  }

  /** 迁移只覆盖全局文件；项目级由调用方按需迁移（无工作区上下文时跳过） */
  private projectFilePathForMigration(): string | null {
    return null;
  }

  getPaths(workspacePath?: string | null): { global: string; project: string | null } {
    return {
      global: this.globalFilePath(),
      project: this.projectFilePath(workspacePath),
    };
  }

  // ─────────────────────────── 读取 ───────────────────────────

  /** 读用户文件（mtime 缓存；不存在/损坏 → 空 + 日志） */
  private readUserFileCached(filePath: string): PolicyUserFile {
    let mtimeMs = -1;
    let size = -1;
    try {
      const st = fs.statSync(filePath);
      mtimeMs = st.mtimeMs;
      size = st.size;
    } catch {
      this.cache.delete(filePath);
      return emptyUserFile();
    }
    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.parsed;
    let parsed = emptyUserFile();
    try {
      parsed = normalizeUserFile(parseYaml(fs.readFileSync(filePath, "utf-8")));
    } catch (e: any) {
      this.logger.warn(`policy file unreadable, ignoring: ${filePath} (${e?.message ?? e})`);
    }
    this.cache.set(filePath, { mtimeMs, size, parsed });
    return parsed;
  }

  /** 热路径：同步取生效策略（供命令判定使用） */
  getEffectivePolicySync(workspacePath?: string | null): EffectivePolicy {
    const factory = loadFactoryPolicy();
    const global = this.readUserFileCached(this.globalFilePath());
    const projectPath = this.projectFilePath(workspacePath);
    const project = projectPath ? this.readUserFileCached(projectPath) : emptyUserFile();
    const removed = [...new Set([...global.readOnlyRemove, ...project.readOnlyRemove])];
    return {
      // 项目级整体优先于全局：项目规则排在前面
      userRules: [...project.rules, ...global.rules],
      factoryRules: factoryRulesOf(factory),
      readOnly: {
        factory: factory.readOnly,
        removed,
        builtin: builtinReadOnlySet(),
      },
    };
  }

  /** 文件工具用：该绝对路径是否命中"可写根"（工作区之外仍允许写/编辑的目录） */
  isPathAllowedSync(workspacePath: string | null | undefined, resolvedPath: string): boolean {
    const policy = this.getEffectivePolicySync(workspacePath);
    return isAllowedPath([...policy.userRules, ...policy.factoryRules], resolvedPath);
  }

  /** 文件工具用：该绝对路径命中的第一条路径规则（用于"敏感路径需要询问"） */
  matchPathRuleSync(workspacePath: string | null | undefined, resolvedPath: string): PathRule | null {
    const policy = this.getEffectivePolicySync(workspacePath);
    return matchPathRule([...policy.userRules, ...policy.factoryRules], resolvedPath);
  }

  /** API：完整生效信息（出厂清单 + 用户改动 + 路径 + 告警） */
  async loadEffective(workspacePath?: string | null): Promise<EffectivePolicyView> {
    const paths = this.getPaths(workspacePath);
    const factory = loadFactoryPolicy();
    const global = this.readUserFileCached(paths.global);
    const project = paths.project ? this.readUserFileCached(paths.project) : emptyUserFile();
    const removed = [...new Set([...global.readOnlyRemove, ...project.readOnlyRemove])];
    const removedSet = new Set(removed.map(normalizeReadOnlyEntry));
    const warnings = [
      ...this.validate(global).warnings.map((w) => `[全局] ${w}`),
      ...(paths.project ? this.validate(project).warnings.map((w) => `[项目] ${w}`) : []),
    ];
    return {
      userRules: [...project.rules, ...global.rules],
      factoryRules: factoryRulesOf(factory),
      factory,
      readOnlyRemove: removed,
      readOnlyEffective: factory.readOnly.filter((e) => !removedSet.has(normalizeReadOnlyEntry(e))),
      paths,
      warnings,
    };
  }

  // ─────────────────────────── 校验 ───────────────────────────

  /**
   * 校验（不抛错，返回 errors/warnings）：
   * - errors：未知字段 / 非法 action / 命令规则含元字符或通配一切 / 路径规则为空或超长
   * - warnings：放行规则命中灾难级或放通整个 shell；readOnlyRemove 里有出厂名单没有的条目
   */
  validate(input: unknown): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (input === null || input === undefined) return { errors, warnings };
    if (typeof input !== "object" || Array.isArray(input)) {
      errors.push("规则文件顶层必须是映射（rules / readOnlyRemove）");
      return { errors, warnings };
    }
    const doc = input as Record<string, unknown>;
    for (const key of Object.keys(doc)) {
      if (key === "rules" || key === "readOnlyRemove") continue;
      errors.push(`未知字段：${key}（只支持 rules / readOnlyRemove）`);
    }

    const rules = doc.rules;
    if (rules !== undefined) {
      if (!Array.isArray(rules)) {
        errors.push("rules 必须是规则数组");
      } else {
        rules.forEach((raw, i) => {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            errors.push(`rules[${i}] 必须是 { action, match } 或 { action, path }`);
            return;
          }
          const rule = raw as Record<string, unknown>;
          const action = rule.action;
          if (typeof action !== "string" || !ACTIONS.includes(action as RuleAction)) {
            errors.push(`rules[${i}].action 必须是 allow / ask / deny`);
            return;
          }
          const isPath = typeof rule.path === "string";
          const isCommand = typeof rule.match === "string";
          if (isPath === isCommand) {
            errors.push(`rules[${i}] 必须二选一：match（命令）或 path（路径）`);
            return;
          }
          if (isPath) {
            const value = (rule.path as string).trim();
            if (!value) {
              errors.push(`rules[${i}].path 为空`);
              return;
            }
            if (value.length > MAX_PATH_LENGTH) {
              errors.push(`rules[${i}].path 过长（>${MAX_PATH_LENGTH} 字符）`);
              return;
            }
            if (value.toLowerCase().startsWith("http")) {
              errors.push(`rules[${i}].path 不是本地路径：${value}`);
            }
            if (!expandPathPattern(value)) errors.push(`rules[${i}].path 无法展开：${value}`);
            return;
          }
          const value = (rule.match as string).trim().replace(/\s+/g, " ");
          if (!value) {
            errors.push(`rules[${i}].match 为空`);
            return;
          }
          if (value.length > MAX_RULE_LENGTH) {
            errors.push(`rules[${i}].match 过长（>${MAX_RULE_LENGTH} 字符）：${value.slice(0, 30)}…`);
          }
          if (value.split(" ").length > MAX_RULE_TOKENS) {
            errors.push(`rules[${i}].match token 过多（>${MAX_RULE_TOKENS}）：${value}`);
          }
          if (META_CHARS.test(value)) {
            errors.push(`rules[${i}].match 含 shell 元字符（规则只做 token 前缀匹配）：${value}`);
          }
          if (BLANKET_RULE.test(value)) {
            errors.push(`rules[${i}].match 是通配一切（*），等于关闭护栏`);
          }
          if (META_CHARS.test(value) || BLANKET_RULE.test(value)) return;
          if (action === "allow") {
            const hit = catastrophicPatternOf(value);
            if (hit) {
              warnings.push(`放行规则 "${value}" 命中灾难级名单（${hit}），仍会被硬拒`);
            }
            if (SHELL_WIDE_RULE.test(value)) {
              warnings.push(`放行规则 "${value}" 会放通整个 shell（包装内层不再判定），请确认你有意如此`);
            }
          }
        });
      }
    }

    const remove = doc.readOnlyRemove;
    if (remove !== undefined) {
      if (!Array.isArray(remove)) {
        errors.push("readOnlyRemove 必须是字符串数组");
      } else {
        const factorySet = new Set(loadFactoryPolicy().readOnly.map(normalizeReadOnlyEntry));
        remove.forEach((entry, i) => {
          if (typeof entry !== "string" || !entry.trim()) {
            errors.push(`readOnlyRemove[${i}] 必须是非空字符串`);
            return;
          }
          if (!factorySet.has(normalizeReadOnlyEntry(entry))) {
            warnings.push(
              `readOnlyRemove 里的 "${entry.trim()}" 不在出厂只读名单里（拼错或已随版本移除），这行没有作用`,
            );
          }
        });
      }
    }
    return { errors, warnings };
  }

  // ─────────────────────────── 写入 ───────────────────────────

  /** 写一个作用域的用户文件（原子写：tmp + rename；写前校验，errors 非空则抛错） */
  async saveUser(
    scope: PolicyScope,
    file: Partial<PolicyUserFile>,
    workspacePath?: string | null,
  ): Promise<EffectivePolicyView> {
    const target = this.scopeFilePath(scope, workspacePath);
    const merged: PolicyUserFile = {
      rules: file.rules ?? [],
      readOnlyRemove: file.readOnlyRemove ?? [],
    };
    const { errors } = this.validate(merged);
    if (errors.length > 0) {
      throw new Error(`规则校验失败：${errors.join("；")}`);
    }
    this.writeFile(target, normalizeUserFile(merged));
    this.logger.log(`policy saved (${scope}): ${target}`);
    return this.loadEffective(workspacePath);
  }

  /** 追加一条规则（审批卡「放通此类」用；已存在则幂等） */
  async appendRule(
    scope: PolicyScope,
    rule: PolicyRule,
    workspacePath?: string | null,
  ): Promise<void> {
    const target = this.scopeFilePath(scope, workspacePath);
    const current = fs.existsSync(target)
      ? normalizeUserFile(parseYaml(fs.readFileSync(target, "utf-8")))
      : emptyUserFile();
    const key = (r: PolicyRule) =>
      isPathRuleOf(r) ? `path:${r.path.toLowerCase()}` : `match:${r.match.toLowerCase()}`;
    const rules = current.rules.some((r) => key(r) === key(rule))
      ? current.rules
      : [...current.rules, rule];
    await this.saveUser(scope, { ...current, rules }, workspacePath);
  }

  /** 重置某个作用域：清空你的改动（覆盖前备份 .bak） */
  async resetUser(scope: PolicyScope = "global", workspacePath?: string | null): Promise<EffectivePolicyView> {
    const target = this.scopeFilePath(scope, workspacePath);
    if (fs.existsSync(target)) this.backup(target);
    this.writeFile(target, emptyUserFile());
    this.logger.log(`policy reset to factory defaults (${scope}): ${target}`);
    return this.loadEffective(workspacePath);
  }

  /** 测试用：清空 mtime 缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  private scopeFilePath(scope: PolicyScope, workspacePath?: string | null): string {
    const target =
      scope === "global" ? this.globalFilePath() : this.projectFilePath(workspacePath);
    if (!target) throw new Error("项目级规则需要会话工作区，但当前会话没有工作区");
    return target;
  }

  private writeFile(target: string, content: PolicyUserFile): void {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const doc = {
      rules: content.rules.map((rule) =>
        isPathRuleOf(rule) ? { action: rule.action, path: rule.path } : { action: rule.action, match: rule.match },
      ),
      readOnlyRemove: content.readOnlyRemove,
    };
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, yaml.dump(doc, { lineWidth: 120 }), "utf-8");
    fs.renameSync(tmp, target);
    this.cache.delete(target); // 失效缓存（mtime 变化也会失效，双保险）
  }

  private backup(target: string): void {
    try {
      fs.copyFileSync(target, `${target}.bak`);
    } catch (e: any) {
      this.logger.warn(`policy backup failed: ${e?.message ?? e}`);
    }
  }

  // ─────────────────────────── 迁移（v1/v2 → v3） ───────────────────────────

  /** 旧 schema（v1 平铺 allow/ask/deny 或 v2 物化 readOnly/workspaceWrite）→ v3 增量 */
  private migrateLegacyFile(target: string): void {
    if (!fs.existsSync(target)) return;
    let doc: unknown;
    try {
      doc = parseYaml(fs.readFileSync(target, "utf-8"));
    } catch {
      return;
    }
    if (!isLegacySchema(doc)) return;
    const migrated = migrateLegacyToUserFile(doc as Record<string, unknown>);
    this.backup(target);
    this.writeFile(target, migrated);
    this.logger.log(`legacy policy schema migrated to v3: ${target}`);
  }
}

// ─────────────────────────── 纯函数工具 ───────────────────────────

function parseYaml(raw: string): unknown {
  try {
    return yaml.load(raw);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isPathRuleOf(rule: PolicyRule): rule is PathRule {
  return typeof (rule as PathRule).path === "string";
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  ];
}

/** 出厂规则表（顺序即优先级：敏感路径 → 可写根 → 必问项） */
export function factoryRulesOf(factory: FactoryPolicy): PolicyRule[] {
  return [
    ...factory.sensitive.map((p) => ({ action: "ask" as const, path: p })),
    ...factory.writeRoots.map((p) => ({ action: "allow" as const, path: p })),
    ...factory.ask.map((m) => ({ action: "ask" as const, match: m })),
  ];
}

/** 旧 schema：v1 顶层 allow/ask/deny，或 v2 的 readOnly/workspaceWrite/writeAllowPaths */
export function isLegacySchema(doc: unknown): boolean {
  if (!isPlainObject(doc)) return false;
  if (Array.isArray(doc.rules) || Array.isArray(doc.readOnlyRemove)) return false;
  return (
    doc.readOnly !== undefined ||
    doc.workspaceWrite !== undefined ||
    doc.writeAllowPaths !== undefined ||
    doc.allow !== undefined ||
    doc.ask !== undefined ||
    doc.deny !== undefined
  );
}

/** 把任意 YAML 文档收成规范形状（v3；旧 schema 请先走 migrateLegacyToUserFile） */
export function normalizeUserFile(doc: unknown): PolicyUserFile {
  const out = emptyUserFile();
  if (!isPlainObject(doc)) return out;
  if (Array.isArray(doc.rules)) {
    for (const raw of doc.rules) {
      if (!isPlainObject(raw)) continue;
      const action = raw.action;
      if (typeof action !== "string" || !ACTIONS.includes(action as RuleAction)) continue;
      if (typeof raw.path === "string" && raw.path.trim()) {
        out.rules.push({ action: action as RuleAction, path: raw.path.trim() });
        continue;
      }
      if (typeof raw.match === "string" && raw.match.trim()) {
        out.rules.push({
          action: action as RuleAction,
          match: raw.match.trim().replace(/\s+/g, " "),
        });
      }
    }
  }
  out.readOnlyRemove = toStringList(doc.readOnlyRemove);
  return out;
}

/**
 * v1/v2 → v3：
 *   v1 顶层三表 / v2 workspaceWrite.{allow,ask,deny}  → 命令规则
 *   v2 readOnly.allow（物化的出厂名单）与出厂名单求差 → readOnlyRemove
 *   v2 writeAllowPaths                                 → 路径 allow 规则（去掉与出厂可写根重复的）
 *   v2 里被用户删掉的出厂必问项                        → 补一条 allow 覆盖（保持"删一行=放通"）
 */
export function migrateLegacyToUserFile(doc: Record<string, unknown>): PolicyUserFile {
  const factory = loadFactoryPolicy();
  const rules: PolicyRule[] = [];

  const v2ReadOnly = isPlainObject(doc.readOnly) ? doc.readOnly : {};
  const v2Work = isPlainObject(doc.workspaceWrite) ? doc.workspaceWrite : {};
  const fileAllow = toStringList(v2Work.allow ?? doc.allow);
  const fileAsk = toStringList(v2Work.ask ?? doc.ask);
  const fileDeny = toStringList(v2Work.deny ?? doc.deny);
  const writePaths = toStringList(doc.writeAllowPaths);

  for (const match of fileDeny) rules.push({ action: "deny", match });
  for (const match of fileAllow) rules.push({ action: "allow", match });
  const factoryAskSet = new Set(factory.ask.map((m) => m.toLowerCase()));
  for (const match of fileAsk) {
    if (!factoryAskSet.has(match.toLowerCase())) rules.push({ action: "ask", match });
  }
  // 用户删掉的出厂必问项 → 放通（"删一行 = 放通"的语义在 v3 里靠 allow 覆盖表达）
  const hadAskList = Array.isArray(v2Work.ask) || Array.isArray(doc.ask);
  const fileAskSet = new Set(fileAsk.map((m) => m.toLowerCase()));
  if (hadAskList) {
    for (const match of factory.ask) {
      if (!fileAskSet.has(match.toLowerCase())) rules.push({ action: "allow", match });
    }
  }
  // 用户加的收紧/放行（v2 readOnly.deny）
  for (const entry of toStringList(v2ReadOnly.deny)) rules.push({ action: "deny", match: entry });

  const factoryRootSet = new Set(factory.writeRoots.map((p) => p.toLowerCase()));
  for (const p of writePaths) {
    if (!factoryRootSet.has(p.toLowerCase())) rules.push({ action: "allow", path: p });
  }

  // 划掉的出厂只读条目 = 出厂名单 − 文件里还在的（只处理"文件确实带了只读名单"的情况）
  const fileReadOnlyAllow = toStringList(v2ReadOnly.allow);
  const readOnlyRemove =
    v2ReadOnly.allow === undefined
      ? []
      : factory.readOnly.filter(
          (entry) => !fileReadOnlyAllow.some((x) => x.toLowerCase() === entry.toLowerCase()),
        );

  return { rules, readOnlyRemove };
}
