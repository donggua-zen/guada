/// <reference types="jest" />

import * as path from "path";
import * as fs from "fs/promises";
import AdmZip from "adm-zip";
import {
  SKILL_ORIGIN_FILE,
  extractZipSafely,
  installSkillsFromDirectory,
  isSafeZipEntryPath,
  parseSkillMetadata,
  writeSkillOrigin,
} from "../../src/modules/skills/core/skill-package.installer";

const tempRoot = path.join(process.cwd(), "temp", `test-skill-installer-${Date.now()}`);

async function writeSkill(
  root: string,
  dirName: string,
  content: string,
  extraFiles: Record<string, string> = {},
): Promise<string> {
  const skillDir = path.join(root, dirName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");
  for (const [file, body] of Object.entries(extraFiles)) {
    const full = path.join(skillDir, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, "utf-8");
  }
  return skillDir;
}

describe("skill-package.installer", () => {
  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("安装技能并写入来源 sidecar", async () => {
    const sourceDir = path.join(tempRoot, "source");
    const skillsDir = path.join(tempRoot, "skills");
    await writeSkill(
      sourceDir,
      "skill-alpha",
      "---\nname: skill-alpha\ndescription: Alpha skill\n---\n\n# Alpha\n",
      { "scripts/run.sh": "echo hello" },
    );

    const result = await installSkillsFromDirectory(sourceDir, skillsDir, {
      origin: {
        source: "skillhub",
        itemId: "skill-alpha",
        version: "1.2.3",
      },
    });

    expect(result.installed).toEqual([{ skillId: "skill-alpha" }]);
    expect(result.errors).toEqual([]);

    const installedDir = path.join(skillsDir, "skill-alpha");
    expect(await fs.readFile(path.join(installedDir, "SKILL.md"), "utf-8")).toContain(
      "name: skill-alpha",
    );
    expect(await fs.readFile(path.join(installedDir, "scripts", "run.sh"), "utf-8")).toBe(
      "echo hello",
    );

    const origin = JSON.parse(
      await fs.readFile(path.join(installedDir, SKILL_ORIGIN_FILE), "utf-8"),
    );
    expect(origin).toMatchObject({
      schemaVersion: 1,
      source: "skillhub",
      itemId: "skill-alpha",
      version: "1.2.3",
    });
    expect(typeof origin.installedAt).toBe("string");
  });

  it("已存在且 force=false 时拒绝覆盖", async () => {
    const sourceDir = path.join(tempRoot, "source");
    const skillsDir = path.join(tempRoot, "skills");
    await writeSkill(sourceDir, "skill-beta", "---\nname: skill-beta\ndescription: Old\n---\n");
    await installSkillsFromDirectory(sourceDir, skillsDir);

    await writeSkill(sourceDir, "skill-beta", "---\nname: skill-beta\ndescription: New\n---\n");
    const result = await installSkillsFromDirectory(sourceDir, skillsDir);

    expect(result.installed).toEqual([]);
    expect(result.errors[0].error).toContain("already exists");
    expect(
      await fs.readFile(path.join(skillsDir, "skill-beta", "SKILL.md"), "utf-8"),
    ).toContain("Old");
  });

  it("force=true 时覆盖并更新 sidecar", async () => {
    const sourceDir = path.join(tempRoot, "source");
    const skillsDir = path.join(tempRoot, "skills");
    await writeSkill(sourceDir, "skill-gamma", "---\nname: skill-gamma\ndescription: v1\n---\n");
    await installSkillsFromDirectory(sourceDir, skillsDir, {
      origin: { source: "skillhub", itemId: "skill-gamma", version: "1.0.0" },
    });

    await writeSkill(sourceDir, "skill-gamma", "---\nname: skill-gamma\ndescription: v2\n---\n");
    const result = await installSkillsFromDirectory(sourceDir, skillsDir, {
      force: true,
      origin: { source: "skillhub", itemId: "skill-gamma", version: "2.0.0" },
    });

    expect(result.installed).toEqual([{ skillId: "skill-gamma" }]);
    expect(
      await fs.readFile(path.join(skillsDir, "skill-gamma", "SKILL.md"), "utf-8"),
    ).toContain("description: v2");

    const origin = JSON.parse(
      await fs.readFile(path.join(skillsDir, "skill-gamma", SKILL_ORIGIN_FILE), "utf-8"),
    );
    expect(origin.version).toBe("2.0.0");
  });

  it("一个包内多技能都安装，并都写来源", async () => {
    const sourceDir = path.join(tempRoot, "source");
    const skillsDir = path.join(tempRoot, "skills");
    await writeSkill(sourceDir, "multi-a", "---\nname: multi-a\ndescription: A\n---\n");
    await writeSkill(sourceDir, "multi-b", "---\nname: multi-b\ndescription: B\n---\n");

    const result = await installSkillsFromDirectory(sourceDir, skillsDir, {
      origin: { source: "skillhub", itemId: "multi-package", version: "1.0.0" },
    });

    expect(result.installed.map((item) => item.skillId).sort()).toEqual(["multi-a", "multi-b"]);
    for (const skillId of ["multi-a", "multi-b"]) {
      const origin = JSON.parse(
        await fs.readFile(path.join(skillsDir, skillId, SKILL_ORIGIN_FILE), "utf-8"),
      );
      expect(origin.itemId).toBe("multi-package");
    }
  });

  it("用 js-yaml 解析块状 description，不把 | 当描述", async () => {
    const sourceDir = path.join(tempRoot, "source");
    await writeSkill(
      sourceDir,
      "block-desc",
      "---\nname: block-desc\ndescription: |\n  第一行说明\n  第二行说明\n---\n\n# Body\n",
    );

    const metadata = await parseSkillMetadata(
      path.join(sourceDir, "block-desc", "SKILL.md"),
    );
    expect(metadata?.name).toBe("block-desc");
    expect(metadata?.description).toBe("第一行说明\n第二行说明");

    const result = await installSkillsFromDirectory(sourceDir, path.join(tempRoot, "skills"));
    expect(result.installed).toEqual([{ skillId: "block-desc" }]);
  });

  it("缺少 name 或不合规的 name 记为单技能错误", async () => {
    const sourceDir = path.join(tempRoot, "source");
    await writeSkill(sourceDir, "no-name", "---\ndescription: No name\n---\n");
    await writeSkill(sourceDir, "bad-name", "---\nname: Bad_Name\ndescription: Bad\n---\n");

    const result = await installSkillsFromDirectory(sourceDir, path.join(tempRoot, "skills"));

    expect(result.installed).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.some((error) => error.error.includes("Skill name not found"))).toBe(true);
    expect(result.errors.some((error) => error.error.includes("invalid"))).toBe(true);
  });

  it("拒绝路径穿越 / 绝对路径条目", () => {
    expect(isSafeZipEntryPath("skill/SKILL.md")).toBe(true);
    expect(isSafeZipEntryPath("skill\\SKILL.md")).toBe(true);
    expect(isSafeZipEntryPath("skill/")).toBe(true);
    expect(isSafeZipEntryPath("../evil.txt")).toBe(false);
    expect(isSafeZipEntryPath("skill/../../evil.txt")).toBe(false);
    expect(isSafeZipEntryPath("/etc/passwd")).toBe(false);
    expect(isSafeZipEntryPath("C:\\Windows\\evil.txt")).toBe(false);
    expect(isSafeZipEntryPath("skill//SKILL.md")).toBe(false);
    expect(isSafeZipEntryPath("")).toBe(false);
  });

  it("安全 ZIP 可以正常解压", async () => {
    const zip = new AdmZip();
    zip.addFile("skill/SKILL.md", Buffer.from("---\nname: safe\ndescription: x\n---\n"));

    const dest = path.join(tempRoot, "extracted");
    await fs.mkdir(dest, { recursive: true });
    extractZipSafely(zip, dest);

    const content = await fs.readFile(path.join(dest, "skill", "SKILL.md"), "utf-8");
    expect(content).toContain("name: safe");
  });

  it("writeSkillOrigin 对无效来源静默跳过", async () => {
    const skillDir = path.join(tempRoot, "empty-origin");
    await fs.mkdir(skillDir, { recursive: true });

    await writeSkillOrigin(skillDir, { source: "", itemId: "" });

    await expect(fs.access(path.join(skillDir, SKILL_ORIGIN_FILE))).rejects.toBeDefined();
  });
});
