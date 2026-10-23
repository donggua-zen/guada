import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildDirectoryTreeBounded } from "../../src/modules/chat/workspace-tree.util";

/// <reference types="jest" />

describe("buildDirectoryTreeBounded", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-tree-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("普通目录：全量返回，目录在前、名称升序，子目录标记 hasChildren", async () => {
    fs.mkdirSync(path.join(dir, "b"));
    fs.writeFileSync(path.join(dir, "z.txt"), "z");
    fs.writeFileSync(path.join(dir, "a.txt"), "a");

    const result = await buildDirectoryTreeBounded(dir, "", 0, 0);

    expect(result.truncated).toBe(false);
    expect(result.nodes.map((n) => n.name)).toEqual(["b", "a.txt", "z.txt"]);
    expect(result.nodes[0]).toEqual(
      expect.objectContaining({
        name: "b",
        path: "b",
        isDirectory: true,
        hasChildren: true,
        children: [],
      }),
    );
  });

  it("超过条目上限：只返回前 2000 条并标记 truncated", async () => {
    for (let i = 0; i < 2500; i++) {
      fs.writeFileSync(path.join(dir, `f-${i}.txt`), "x");
    }

    const result = await buildDirectoryTreeBounded(dir, "", 0, 0);

    expect(result.nodes).toHaveLength(2000);
    expect(result.truncated).toBe(true);
  }, 60000);

  it("node_modules 始终跳过", async () => {
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "a.txt"), "a");

    const result = await buildDirectoryTreeBounded(dir, "", 0, 0);

    expect(result.nodes.map((n) => n.name)).toEqual(["a.txt"]);
  });
});
