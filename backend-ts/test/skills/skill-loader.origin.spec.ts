/// <reference types="jest" />

import * as path from "path";
import * as fs from "fs/promises";
import { SkillLoaderService } from "../../src/modules/skills/core/skill-loader.service";

const tempRoot = path.join(process.cwd(), "temp", `test-skill-origin-${Date.now()}`);

async function createSkillDir(name: string, origin?: string): Promise<string> {
  const skillDir = path.join(tempRoot, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Origin test skill\nversion: 1.0.0\n---\n\n# Body\n`,
    "utf-8",
  );
  if (origin !== undefined) {
    await fs.writeFile(path.join(skillDir, ".skill-origin.json"), origin, "utf-8");
  }
  return skillDir;
}

describe("SkillLoaderService origin", () => {
  const loader = new SkillLoaderService();

  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("读取合法 sidecar 并挂到 SkillDefinition.origin", async () => {
    const skillDir = await createSkillDir(
      "with-origin",
      JSON.stringify({
        schemaVersion: 1,
        source: "skillhub",
        itemId: "with-origin",
        version: "2.1.0",
        installedAt: "2026-11-02T00:00:00.000Z",
      }),
    );

    const definition = await loader.loadManifest(skillDir, "global", tempRoot);

    expect(definition.origin).toEqual({
      source: "skillhub",
      itemId: "with-origin",
      version: "2.1.0",
      installedAt: "2026-11-02T00:00:00.000Z",
    });
  });

  it("没有 sidecar 时不带 origin", async () => {
    const skillDir = await createSkillDir("no-origin");
    const definition = await loader.loadManifest(skillDir, "global", tempRoot);
    expect(definition.origin).toBeUndefined();
  });

  it("sidecar 非法 JSON 时忽略，不影响技能加载", async () => {
    const skillDir = await createSkillDir("broken-origin", "{ not json");
    const definition = await loader.loadManifest(skillDir, "global", tempRoot);
    expect(definition.id).toBe("broken-origin");
    expect(definition.origin).toBeUndefined();
  });

  it("sidecar 缺少 source/itemId 时忽略", async () => {
    const skillDir = await createSkillDir(
      "incomplete-origin",
      JSON.stringify({ source: "skillhub" }),
    );
    const definition = await loader.loadManifest(skillDir, "global", tempRoot);
    expect(definition.origin).toBeUndefined();
  });

  it("超大 sidecar 不读取", async () => {
    const skillDir = await createSkillDir(
      "large-origin",
      JSON.stringify({ source: "skillhub", itemId: "x", padding: "a".repeat(5000) }),
    );
    const definition = await loader.loadManifest(skillDir, "global", tempRoot);
    expect(definition.origin).toBeUndefined();
  });
});
