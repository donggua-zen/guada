/**
 * 出厂规则：**数据文件**（不是硬编码常量），随包分发。
 *
 * `defaults/policy-defaults.yaml` 由 nest-cli 的 assets 拷进 dist，因此 `__dirname` 相对定位
 * 在 dev / 生产（resources/backend-ts/dist）/ jest（src）三种环境下都成立。
 *
 * 结构（4 个区）：
 *   readOnly    只读档名单（条目 = 命令前缀）
 *   ask         必问项（命令规则，action=ask）
 *   sensitive   敏感路径（路径规则，action=ask）
 *   writeRoots  可写根（路径规则，action=allow）
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { PolicyRule } from "./types";

let textCache: string | null = null;
let parsedCache: FactoryPolicy | null = null;

export interface FactoryPolicy {
  /** 只读档名单（命令前缀，隐式"其后任意参数"） */
  readOnly: string[];
  /** 必问项（命令前缀） */
  ask: string[];
  /** 敏感路径（glob；读写都先问一次） */
  sensitive: string[];
  /** 可写根（glob；工作区外仍允许写/删/建） */
  writeRoots: string[];
}

/** 出厂规则文件路径 */
export function policyDefaultsPath(): string {
  return path.join(__dirname, "defaults", "policy-defaults.yaml");
}

/** 出厂规则原文（进程内缓存；缺失即抛错——那是打包错误，不该静默降级） */
export function loadPolicyDefaultsText(): string {
  if (textCache === null) {
    textCache = fs.readFileSync(policyDefaultsPath(), "utf-8");
  }
  return textCache;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 出厂规则（进程内缓存） */
export function loadFactoryPolicy(): FactoryPolicy {
  if (!parsedCache) {
    const doc = yaml.load(loadPolicyDefaultsText()) as Record<string, unknown> | null;
    const src = doc && typeof doc === "object" ? doc : {};
    parsedCache = {
      readOnly: toStringList(src.readOnly),
      ask: toStringList(src.ask),
      sensitive: toStringList(src.sensitive),
      writeRoots: toStringList(src.writeRoots),
    };
  }
  return parsedCache;
}

/**
 * 出厂规则表（引擎消费）：
 * 路径规则在前（敏感 → 可写根），然后命令规则（必问项）。
 * 同一种类内部"从上到下第一条命中"，所以更具体的敏感路径要排在可写根前面。
 */
export function factoryRules(factory: FactoryPolicy = loadFactoryPolicy()): PolicyRule[] {
  return [
    ...factory.sensitive.map((path) => ({ action: "ask" as const, path })),
    ...factory.writeRoots.map((path) => ({ action: "allow" as const, path })),
    ...factory.ask.map((match) => ({ action: "ask" as const, match })),
  ];
}
