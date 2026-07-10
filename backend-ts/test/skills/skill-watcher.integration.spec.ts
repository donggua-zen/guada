import { SkillWatcherService } from "../../src/modules/skills/core/skill-watcher.service";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

/**
 * 真实文件系统集成测试
 *
 * 验证完整链路：创建/删除文件 → chokidar 检测 → dispatch → 回调被调用
 * 不 mock 任何东西，使用真实 chokidar + 真实文件系统。
 */
describe("SkillWatcherService 真实文件系统集成", () => {
  let watcher: SkillWatcherService;
  let onAdd: jest.Mock;
  let onRemove: jest.Mock;
  let tmpDir: string;
  let skillsDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-int-"));
    skillsDir = path.join(tmpDir, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    watcher = new SkillWatcherService();
    onAdd = jest.fn().mockResolvedValue(undefined);
    onRemove = jest.fn();

    // 启动空 watcher
    watcher.start();

    // 加入真实监控路径（绝对路径）
    const pattern = path.join(skillsDir, "*/SKILL.md");
    watcher.addWatch(pattern, { onAdd, onRemove });

    // 等待 chokidar 初始化
    await new Promise((r) => setTimeout(r, 1500));
  });

  afterEach(async () => {
    jest.useRealTimers();
    watcher.stop();
    // 清理测试目录
    const entries = fs.readdirSync(skillsDir);
    for (const entry of entries) {
      fs.rmSync(path.join(skillsDir, entry), { recursive: true, force: true });
    }
  });

  // ================================================================
  // 创建文件 → chokidar 检测 → onAdd 被调用
  // ================================================================

  it("创建技能目录和 SKILL.md 后应触发 onAdd", async () => {
    const skillName = "test-create";
    const skillDir = path.join(skillsDir, skillName);

    // 创建技能目录和 SKILL.md
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Test\n---\n\nContent.`
    );

    // 等待 chokidar 检测
    await new Promise((r) => setTimeout(r, 3000));

    // 验证：onAdd 被调用，且参数是技能目录的绝对路径
    expect(onAdd).toHaveBeenCalled();
    const arg = onAdd.mock.calls[0][0];
    expect(arg).toContain(skillName);
    expect(path.isAbsolute(arg)).toBe(true);
  }, 10000);

  // ================================================================
  // 删除文件 → chokidar 检测 → onRemove 被调用
  // ================================================================

  it("删除技能目录后应触发 onRemove", async () => {
    const skillName = "test-delete";
    const skillDir = path.join(skillsDir, skillName);

    // 先创建
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Test\n---\n\nContent.`
    );
    await new Promise((r) => setTimeout(r, 3000));
    onAdd.mockClear();
    onRemove.mockClear();

    // 删除整个技能目录
    fs.rmSync(skillDir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 3000));

    // 验证：onRemove 被调用，且参数是技能 ID（小写）
    expect(onRemove).toHaveBeenCalled();
    expect(onRemove.mock.calls[0][0]).toBe(skillName);
  }, 10000);

  // ================================================================
  // 完整生命周期：创建 → 删除 → 重新创建
  // ================================================================

  it("完整生命周期：创建 → 删除 → 重新创建", async () => {
    const skillName = "test-lifecycle";
    const skillDir = path.join(skillsDir, skillName);

    // 创建
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Test\n---\n\nContent.`
    );
    await new Promise((r) => setTimeout(r, 3000));
    expect(onAdd).toHaveBeenCalledTimes(1);
    onAdd.mockClear();
    onRemove.mockClear();

    // 删除
    fs.rmSync(skillDir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 3000));
    // 删除时可能触发 unlink(文件) + unlinkDir(目录) 两个事件，至少应触发一次
    expect(onRemove).toHaveBeenCalled();
    const removeArg = onRemove.mock.calls[0][0];
    expect(removeArg).toBe(skillName);
    onAdd.mockClear();
    onRemove.mockClear();

    // 重新创建
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Recreated\n---\n\nContent.`
    );
    await new Promise((r) => setTimeout(r, 3000));
    expect(onAdd).toHaveBeenCalledTimes(1);
  }, 20000);
});