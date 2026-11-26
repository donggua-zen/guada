import { describe, it, expect } from "vitest";
import {
  resolveSelectedProject,
  toProjectOptions,
  workspaceBasename,
} from "./skillsProjectScope";
import type { ProjectGroup } from "@/types/session";

const project = (patch: Partial<ProjectGroup>): ProjectGroup => ({
  id: "pg-a",
  name: "demo",
  path: "/work/demo",
  pathKey: "/work/demo",
  sortOrder: 0,
  isOverridden: false,
  icon: null,
  kind: "workspace",
  ...patch,
});

const general = (): ProjectGroup => ({
  id: "__general__",
  name: "",
  path: null,
  pathKey: null,
  sortOrder: Number.MAX_SAFE_INTEGER,
  isOverridden: false,
  icon: null,
  kind: "general",
});

describe("workspaceBasename", () => {
  it("同时接受正反斜杠并忽略末尾分隔符", () => {
    expect(workspaceBasename("D:\\AI\\ai_chat\\")).toBe("ai_chat");
    expect(workspaceBasename("/home/u/proj//")).toBe("proj");
    expect(workspaceBasename("")).toBe("");
  });
});

describe("toProjectOptions", () => {
  it("排除虚拟「通用」桶与无目录行", () => {
    const options = toProjectOptions([
      project({ id: "pg-a", name: "A", path: "/work/a" }),
      general(),
      project({ id: "pg-null", name: "无目录", path: null, pathKey: null }),
    ]);

    expect(options.map((o) => o.value)).toEqual(["pg-a"]);
  });

  it("按 sortOrder 升序，与侧栏顺序一致", () => {
    const options = toProjectOptions([
      project({ id: "pg-b", name: "B", path: "/work/b", sortOrder: 2 }),
      project({ id: "pg-a", name: "A", path: "/work/a", sortOrder: 1 }),
    ]);

    expect(options.map((o) => o.value)).toEqual(["pg-a", "pg-b"]);
  });

  it("同名项目附加可区分的目录后缀", () => {
    const options = toProjectOptions([
      project({ id: "pg-1", name: "docs", path: "/work/frontend/docs-site" }),
      project({ id: "pg-2", name: "docs", path: "/work/backend/docs-api", sortOrder: 1 }),
      project({ id: "pg-3", name: "unique", path: "/work/only", sortOrder: 2 }),
    ]);

    expect(options.map((o) => o.label)).toEqual([
      "docs · docs-site",
      "docs · docs-api",
      "unique",
    ]);
  });

  it("同名且末段也相同（不同父目录）时继续加长后缀直到可区分", () => {
    const options = toProjectOptions([
      project({ id: "pg-1", name: "ai_video", path: "D:\\AI\\projects\\ai_video" }),
      project({ id: "pg-2", name: "ai_video", path: "D:\\AI\\archive\\ai_video", sortOrder: 1 }),
    ]);

    const labels = options.map((o) => o.label);
    expect(labels[0]).toBe("ai_video · projects/ai_video");
    expect(labels[1]).toBe("ai_video · archive/ai_video");
    // 关键：两个选项必须互不相同，否则用户无法区分
    expect(labels[0]).not.toBe(labels[1]);
  });

  it("同名且路径完全无法区分时退化为完整路径", () => {
    const options = toProjectOptions([
      project({ id: "pg-1", name: "x", path: "D:\\same\\x" }),
      project({ id: "pg-2", name: "x", path: "D:\\same\\x\\", sortOrder: 1 }),
    ]);

    expect(options).toHaveLength(2);
    // 即使退化也不会变成空标签
    expect(options.every((o) => o.label.length > 0)).toBe(true);
  });
});

describe("resolveSelectedProject", () => {
  it("有效 id 返回分组本身", () => {
    const groups = [project({ id: "pg-a" })];
    expect(resolveSelectedProject(groups, "pg-a")?.id).toBe("pg-a");
  });

  it("项目已被删除（id 不存在）时回落 null", () => {
    expect(resolveSelectedProject([project({ id: "pg-a" })], "pg-gone")).toBeNull();
  });

  it("未选择 / 虚拟通用桶 / 无目录都视为无效", () => {
    const groups = [project({ id: "pg-a" }), general()];
    expect(resolveSelectedProject(groups, null)).toBeNull();
    expect(resolveSelectedProject(groups, "")).toBeNull();
    expect(resolveSelectedProject(groups, "__general__")).toBeNull();
    expect(
      resolveSelectedProject([project({ path: null, pathKey: null })], "pg-a"),
    ).toBeNull();
  });
});
