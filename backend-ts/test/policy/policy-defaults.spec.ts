/**
 * 出厂规则（`defaults/policy-defaults.yaml`）：结构完整性 + 与代码表的一致性。
 *
 * 这份文件是"只读名单 + 必问项 + 敏感路径 + 可写根"的出厂值，随包分发、**不物化**给用户。
 * 漂移断言的作用：以后往分析器表里加命令却忘了同步出厂文件时，这里会红。
 */
import * as fs from "fs";
import * as yaml from "js-yaml";
import {
  builtinReadOnlyCommands,
  factoryRules,
  loadFactoryPolicy,
  policyDefaultsPath,
} from "../../src/common/services/command-policy";
import { PolicyRulesService, factoryRulesOf } from "../../src/common/services/policy-rules.service";

describe("出厂规则（policy-defaults.yaml）", () => {
  const raw = fs.readFileSync(policyDefaultsPath(), "utf-8");
  const factory = loadFactoryPolicy();

  it("结构完整：四个区都有内容，且带说明性注释", () => {
    expect(factory.readOnly.length).toBeGreaterThan(100);
    expect(factory.ask.length).toBeGreaterThanOrEqual(20);
    expect(factory.sensitive.length).toBeGreaterThanOrEqual(15);
    expect(factory.writeRoots.length).toBeGreaterThanOrEqual(15);
    expect(raw.startsWith("#")).toBe(true);
    expect(yaml.load(raw)).toMatchObject({
      readOnly: expect.any(Array),
      ask: expect.any(Array),
      sensitive: expect.any(Array),
      writeRoots: expect.any(Array),
    });
  });

  it("漂移断言：文件里的只读名单 == 分析器表派生的内置名单", () => {
    const fromFile = [...factory.readOnly].sort();
    expect(fromFile).toEqual(builtinReadOnlyCommands());
    expect(new Set(fromFile).size).toBe(fromFile.length);
  });

  it("必问项是末尾 * 的命令前缀、不含 shell 元字符", () => {
    for (const rule of factory.ask) {
      expect(rule.endsWith(" *")).toBe(true);
      expect(/[;|&><`$()"'\\]/.test(rule)).toBe(false);
    }
  });

  it("敏感路径与可写根是普通路径 glob（不含 shell 元字符）", () => {
    for (const entry of [...factory.sensitive, ...factory.writeRoots]) {
      expect(entry.length).toBeGreaterThan(0);
      expect(/[;|&><`$()"']/.test(entry)).toBe(false);
    }
  });

  it("规则表顺序：敏感路径先于可写根（更具体的先判定）", () => {
    const rules = factoryRules();
    const firstSensitive = rules.findIndex((r) => "path" in r && r.action === "ask");
    const firstRoot = rules.findIndex((r) => "path" in r && r.action === "allow");
    expect(firstSensitive).toBeGreaterThanOrEqual(0);
    expect(firstRoot).toBeGreaterThan(firstSensitive);
  });

  it("出厂规则本身通过校验（errors 为空）", () => {
    const service = new PolicyRulesService({ get: () => undefined } as any);
    const { errors } = service.validate({ rules: factoryRulesOf(factory), readOnlyRemove: [] });
    expect(errors).toEqual([]);
  });
});
