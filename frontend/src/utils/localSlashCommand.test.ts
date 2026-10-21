import { describe, it, expect } from "vitest";
import { parseLocalSlashCommand } from "./localSlashCommand";

describe("parseLocalSlashCommand", () => {
  it("裸命令与别名命中（大小写/前后空白不敏感）", () => {
    expect(parseLocalSlashCommand("/compact")).toEqual({ name: "compact" });
    expect(parseLocalSlashCommand("/compress")).toEqual({ name: "compress" });
    expect(parseLocalSlashCommand("/COMPACT")).toEqual({ name: "compact" });
    expect(parseLocalSlashCommand("  /compact  ")).toEqual({ name: "compact" });
  });

  it("带自由文本指令", () => {
    expect(parseLocalSlashCommand("/compact 只保留最近 10 轮")).toEqual({
      name: "compact",
      instructions: "只保留最近 10 轮",
    });
    expect(parseLocalSlashCommand("/compact\n保留决策\n丢弃工具输出")).toEqual({
      name: "compact",
      instructions: "保留决策\n丢弃工具输出",
    });
  });

  it("未知斜杠命令按普通消息处理", () => {
    expect(parseLocalSlashCommand("/help")).toBeNull();
    expect(parseLocalSlashCommand("/clear")).toBeNull();
    expect(parseLocalSlashCommand("/usr/bin/env")).toBeNull();
  });

  it("正文中的斜杠不误判", () => {
    expect(parseLocalSlashCommand("请解释 /compact 是什么意思")).toBeNull();
    expect(parseLocalSlashCommand("第一行\n/compact")).toBeNull();
    expect(parseLocalSlashCommand("/compactX")).toBeNull();
  });

  it("空值/纯斜杠不命中", () => {
    expect(parseLocalSlashCommand("")).toBeNull();
    expect(parseLocalSlashCommand(undefined)).toBeNull();
    expect(parseLocalSlashCommand(null)).toBeNull();
    expect(parseLocalSlashCommand("/")).toBeNull();
  });
});
