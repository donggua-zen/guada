import {
  findToolNameConflicts,
  resolveToolOwners,
  toPublicToolName,
} from "./mcp-tool-name";

describe("toPublicToolName", () => {
  it("只加 mcp__ 前缀，不含服务器命名空间", () => {
    expect(toPublicToolName("web_search")).toBe("mcp__web_search");
  });
});

describe("findToolNameConflicts", () => {
  const others = [
    { id: "srv1", tools: { web_search: {}, fetch: {} } },
    { id: "srv2", tools: null },
    { id: "srv3" },
  ];

  it("无重名 → 空", () => {
    expect(findToolNameConflicts({ other_tool: {} }, others)).toEqual([]);
  });

  it("重名时列出模型可见工具名与占用者", () => {
    expect(findToolNameConflicts({ web_search: {} }, others)).toEqual([
      { tool: "mcp__web_search", ownerServerId: "srv1" },
    ]);
  });

  it("多个重名逐个列出", () => {
    expect(
      findToolNameConflicts({ fetch: {}, web_search: {}, mine: {} }, others),
    ).toEqual([
      { tool: "mcp__fetch", ownerServerId: "srv1" },
      { tool: "mcp__web_search", ownerServerId: "srv1" },
    ]);
  });

  it("忽略 tools 为 null / 缺失的服务器", () => {
    expect(findToolNameConflicts({ any: {} }, others)).toEqual([]);
  });

  it("自身工具表为 null → 空", () => {
    expect(findToolNameConflicts(null, others)).toEqual([]);
  });
});

describe("resolveToolOwners", () => {
  const older = {
    id: "srvOld",
    createdAt: "2026-01-01T00:00:00.000Z",
    tools: { search: {}, old_only: {} },
  };
  const newer = {
    id: "srvNew",
    createdAt: "2026-02-01T00:00:00.000Z",
    tools: { search: {}, new_only: {} },
  };

  it("同名工具归创建更早的服务器", () => {
    const owners = resolveToolOwners([newer, older]);
    expect(owners.get("mcp__search")).toBe("srvOld");
    expect(owners.get("mcp__old_only")).toBe("srvOld");
    expect(owners.get("mcp__new_only")).toBe("srvNew");
  });

  it("结果与入参顺序无关（不依赖 listEnabled 的界面排序）", () => {
    expect(resolveToolOwners([older, newer])).toEqual(
      resolveToolOwners([newer, older]),
    );
  });

  it("没有 createdAt 时按先出现者，保持确定性", () => {
    const owners = resolveToolOwners([
      { id: "a", tools: { t: {} } },
      { id: "b", tools: { t: {} } },
    ]);
    expect(owners.get("mcp__t")).toBe("a");
  });

  it("跳过没有工具的服务器", () => {
    expect(resolveToolOwners([{ id: "x", createdAt: "", tools: null }]).size).toBe(0);
  });
});
