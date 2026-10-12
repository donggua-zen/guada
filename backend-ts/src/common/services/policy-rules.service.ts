/**
 * 用户可配的命令策略规则（allow / ask / deny 三张表 + 工作区外可写路径）。
 *
 * 载体为 YAML 双级文件（可手编、UI 读写同一文件）：
 *   全局：`<SETTINGS_DIR>/policy.yaml`（与 account.json / models.json 同目录）
 *   项目：`<workspace>/.guada/policy.yaml`（与 .guada/skills 同语义，随项目走）
 *
 * 合并语义：两级**并集**；优先级由引擎在匹配时决定（T0 > deny > ask > allow > 内置判定），
 * 因此"项目级 deny 压全局 allow"天然成立。
 *
 * 热路径：`getEffectiveSync()` 用 mtime 缓存（每命令 ≤2 次 stat），
 * 供 shell.plugin 的判定同步调用；API 侧用 `loadEffective()` 拿完整信息（含原文与校验告警）。
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  EMPTY_RULE_SET,
  catastrophicPatternOf,
  type CommandRuleSet,
} from "./command-policy";

/** 文件形状（与引擎的 CommandRuleSet 相比多了可写路径） */
export interface PolicyRulesFile extends CommandRuleSet {
  /** 工作区外仍允许 write/edit 的路径（文件工具用） */
  writeAllowPaths: string[];
}

export const EMPTY_POLICY_FILE: PolicyRulesFile = {
  allow: [],
  ask: [],
  deny: [],
  writeAllowPaths: [],
};

export type PolicyScope = "global" | "project";

export interface EffectivePolicyRules {
  /** 合并后的三张表（引擎直接消费） */
  rules: CommandRuleSet;
  /** 合并后的工作区外可写路径 */
  writeAllowPaths: string[];
  /** 两级原文（设置页展示/编辑用） */
  sources: { global: PolicyRulesFile; project: PolicyRulesFile };
  paths: { global: string; project: string | null };
  /** 校验告警（不阻断，仅提示） */
  warnings: string[];
}

const MAX_RULE_LENGTH = 120;
const MAX_RULE_TOKENS = 8;
/** 规则只是"token 前缀匹配器"，出现 shell 元字符说明用户把它当命令写了 */
const META_CHARS = /[;|&><`$()"'\\]/;
/** 通配一切：拒绝（等于关掉整个护栏） */
const BLANKET_RULE = /^\*+$/;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  parsed: PolicyRulesFile;
}

@Injectable()
export class PolicyRulesService {
  private readonly logger = new Logger(PolicyRulesService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly configService: ConfigService) {}

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

  getPaths(workspacePath?: string | null): { global: string; project: string | null } {
    return {
      global: this.globalFilePath(),
      project: this.projectFilePath(workspacePath),
    };
  }

  // ─────────────────────────── 读取 ───────────────────────────

  /** 读一个策略文件（mtime 缓存；不存在/损坏 → 空表 + 日志） */
  private readFileCached(filePath: string): PolicyRulesFile {
    let mtimeMs = -1;
    let size = -1;
    try {
      const st = fs.statSync(filePath);
      mtimeMs = st.mtimeMs;
      size = st.size;
    } catch {
      // 文件不存在：视为空
      this.cache.delete(filePath);
      return { allow: [], ask: [], deny: [], writeAllowPaths: [] };
    }
    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.parsed;
    let parsed: PolicyRulesFile = { allow: [], ask: [], deny: [], writeAllowPaths: [] };
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const doc = yaml.load(raw);
      parsed = normalizePolicyFile(doc);
    } catch (e: any) {
      this.logger.warn(`policy file unreadable, ignoring: ${filePath} (${e?.message ?? e})`);
    }
    this.cache.set(filePath, { mtimeMs, size, parsed });
    return parsed;
  }

  /** 热路径：同步取生效规则（供命令判定使用） */
  getEffectiveSync(workspacePath?: string | null): CommandRuleSet {
    return this.merge(this.readFileCached(this.globalFilePath()), workspacePath).rules;
  }

  /** 工作区外可写路径（文件工具用） */
  getWriteAllowPathsSync(workspacePath?: string | null): string[] {
    return this.merge(this.readFileCached(this.globalFilePath()), workspacePath).writeAllowPaths;
  }

  /** API：完整生效信息（含两级原文、文件路径、校验告警） */
  async loadEffective(workspacePath?: string | null): Promise<EffectivePolicyRules> {
    const paths = this.getPaths(workspacePath);
    const global = this.readFileCached(paths.global);
    const project = paths.project ? this.readFileCached(paths.project) : { ...EMPTY_POLICY_FILE };
    const merged = this.merge(global, workspacePath);
    const warnings = [
      ...this.validate(global).warnings.map((w) => `[全局] ${w}`),
      ...(paths.project ? this.validate(project).warnings.map((w) => `[项目] ${w}`) : []),
    ];
    return {
      rules: merged.rules,
      writeAllowPaths: merged.writeAllowPaths,
      sources: { global, project },
      paths,
      warnings,
    };
  }

  private merge(
    global: PolicyRulesFile,
    workspacePath?: string | null,
  ): { rules: CommandRuleSet; writeAllowPaths: string[] } {
    const projectPath = this.projectFilePath(workspacePath);
    const project = projectPath ? this.readFileCached(projectPath) : EMPTY_POLICY_FILE;
    const union = (a: readonly string[], b: readonly string[]) => [
      ...new Set([...a, ...b].map((x) => x.trim()).filter(Boolean)),
    ];
    return {
      rules: {
        allow: union(global.allow, project.allow),
        ask: union(global.ask, project.ask),
        deny: union(global.deny, project.deny),
      },
      writeAllowPaths: union(global.writeAllowPaths, project.writeAllowPaths),
    };
  }

  // ─────────────────────────── 校验 ───────────────────────────

  /**
   * 校验（不抛错，返回 errors/warnings）：
   * - errors：条目空/超长/token 过多/含 shell 元字符/单条 `*`
   * - warnings：allow 规则命中灾难级名单、或放通整个 shell（`powershell *` 等，等于绕过判定）
   */
  validate(input: unknown): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (input === null || input === undefined) return { errors, warnings };
    if (typeof input !== "object" || Array.isArray(input)) {
      errors.push("规则文件顶层必须是映射（allow / ask / deny / writeAllowPaths）");
      return { errors, warnings };
    }
    const doc = input as Record<string, unknown>;
    for (const key of Object.keys(doc)) {
      if (!["allow", "ask", "deny", "writeAllowPaths"].includes(key)) {
        errors.push(`未知字段：${key}（只支持 allow / ask / deny / writeAllowPaths）`);
      }
    }
    for (const key of ["allow", "ask", "deny"] as const) {
      const list = doc[key];
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        errors.push(`${key} 必须是字符串数组`);
        continue;
      }
      list.forEach((entry, i) => {
        if (typeof entry !== "string") {
          errors.push(`${key}[${i}] 必须是字符串`);
          return;
        }
        const rule = entry.trim().replace(/\s+/g, " ");
        if (!rule) {
          errors.push(`${key}[${i}] 为空`);
          return;
        }
        if (rule.length > MAX_RULE_LENGTH) {
          errors.push(`${key}[${i}] 过长（>${MAX_RULE_LENGTH} 字符）：${rule.slice(0, 30)}…`);
        }
        if (rule.split(" ").length > MAX_RULE_TOKENS) {
          errors.push(`${key}[${i}] token 过多（>${MAX_RULE_TOKENS}）：${rule}`);
        }
        if (META_CHARS.test(rule)) {
          errors.push(`${key}[${i}] 含 shell 元字符（规则只做 token 前缀匹配）：${rule}`);
        }
        if (BLANKET_RULE.test(rule)) {
          errors.push(`${key}[${i}] 是通配一切（*），等于关闭护栏`);
        }
        if (key === "allow" && !BLANKET_RULE.test(rule) && !META_CHARS.test(rule)) {
          const hit = catastrophicPatternOf(rule);
          if (hit) {
            warnings.push(`allow 规则 "${rule}" 命中灾难级名单（${hit}），仍会被硬拒`);
          }
          if (/^(powershell|pwsh|cmd|(?:ba|z|da|k)?sh)(\s|\*|$)/i.test(rule)) {
            warnings.push(
              `allow 规则 "${rule}" 会放通整个 shell（包装内层不再判定），请确认你有意如此`,
            );
          }
        }
      });
    }
    const writePaths = doc.writeAllowPaths;
    if (writePaths !== undefined) {
      if (!Array.isArray(writePaths)) {
        errors.push("writeAllowPaths 必须是字符串数组");
      } else {
        writePaths.forEach((entry, i) => {
          if (typeof entry !== "string" || !entry.trim()) {
            errors.push(`writeAllowPaths[${i}] 必须是非空字符串`);
            return;
          }
          const p = entry.trim();
          if (p.toLowerCase().startsWith("http")) {
            errors.push(`writeAllowPaths[${i}] 不是本地路径：${p}`);
          }
        });
      }
    }
    return { errors, warnings };
  }

  // ─────────────────────────── 写入 ───────────────────────────

  /** 写一个作用域的规则文件（原子写：tmp + rename；写前校验，errors 非空则抛错） */
  async saveScope(
    scope: PolicyScope,
    rules: Partial<PolicyRulesFile>,
    workspacePath?: string | null,
  ): Promise<EffectivePolicyRules> {
    const target =
      scope === "global" ? this.globalFilePath() : this.projectFilePath(workspacePath);
    if (!target) {
      throw new Error("项目级规则需要会话工作区，但当前会话没有工作区");
    }
    const merged = { ...EMPTY_POLICY_FILE, ...rules } as PolicyRulesFile;
    const { errors } = this.validate(merged);
    if (errors.length > 0) {
      throw new Error(`规则校验失败：${errors.join("；")}`);
    }
    const normalized = normalizePolicyFile(merged);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, yaml.dump(normalized, { lineWidth: 120 }), "utf-8");
    fs.renameSync(tmp, target);
    this.cache.delete(target); // 失效缓存（mtime 变化也会失效，双保险）
    this.logger.log(`policy rules saved (${scope}): ${target}`);
    return this.loadEffective(workspacePath);
  }

  /** 追加一条 allow 规则（审批卡「放通此类」用；已存在则幂等） */
  async appendAllowRule(
    scope: PolicyScope,
    rule: string,
    workspacePath?: string | null,
  ): Promise<void> {
    const target =
      scope === "global" ? this.globalFilePath() : this.projectFilePath(workspacePath);
    if (!target) throw new Error("项目级规则需要会话工作区");
    const current = fs.existsSync(target)
      ? normalizePolicyFile(yaml.load(fs.readFileSync(target, "utf-8")))
      : { ...EMPTY_POLICY_FILE, allow: [], ask: [], deny: [], writeAllowPaths: [] };
    const normalizedRule = rule.trim().replace(/\s+/g, " ");
    const allow = [...new Set([...current.allow, normalizedRule])];
    await this.saveScope(scope, { ...current, allow }, workspacePath);
  }

  /** 测试用：清空 mtime 缓存 */
  clearCache(): void {
    this.cache.clear();
  }
}

/** 把任意 YAML 文档收成规范形状（去重、trim、丢弃非法项由 validate 报告） */
export function normalizePolicyFile(doc: unknown): PolicyRulesFile {
  const out: PolicyRulesFile = { allow: [], ask: [], deny: [], writeAllowPaths: [] };
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return out;
  const src = doc as Record<string, unknown>;
  for (const key of ["allow", "ask", "deny", "writeAllowPaths"] as const) {
    const list = src[key];
    if (!Array.isArray(list)) continue;
    out[key] = [
      ...new Set(
        list
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim().replace(/\s+/g, " "))
          .filter(Boolean),
      ),
    ];
  }
  return out;
}

/** 引擎空表兜底（供测试与调用方复用） */
export const NO_RULES = EMPTY_RULE_SET;
