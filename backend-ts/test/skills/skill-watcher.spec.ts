import { SkillWatcherService } from "../../src/modules/skills/core/skill-watcher.service";

/**
 * 热更新核心测试：验证 SkillWatcherService.dispatch() 的路径处理和回调触发
 *
 * 关键验证点：
 * 1. 文件 add/change → onAdd 接收绝对路径
 * 2. 文件 unlink → onRemove 接收 skill ID
 * 3. 无关文件不触发回调
 * 4. 多模式匹配时选最长前缀
 * 5. debounce 间隔内重复事件只触发一次
 */
describe("SkillWatcherService", () => {
  let watcher: SkillWatcherService;
  let onAdd: jest.Mock;
  let onRemove: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    watcher = new SkillWatcherService();
    onAdd = jest.fn().mockResolvedValue(undefined);
    onRemove = jest.fn();

    // 注入 handlers（绕过 chokidar，直接测试 dispatch）
    // chokidar 在所有平台都使用前向斜杠，所以用 "/" 匹配
    (watcher as any).handlers.set("skills/*/SKILL.md", { onAdd, onRemove });
    (watcher as any).handlers.set(".system/*/SKILL.md", { onAdd, onRemove });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** 触发 dispatch 并等待 debounce 完成 */
  async function dispatchAndSettle(event: string, filePath: string) {
    (watcher as any).dispatch(event, filePath);
    jest.advanceTimersByTime(500); // 超过 debounce 300ms
    await Promise.resolve(); // 让微任务队列执行
  }

  // ── add / change 事件 ──

  it("add 事件应触发 onAdd 并传递绝对路径", async () => {
    await dispatchAndSettle("add", "skills/my-skill/SKILL.md");

    expect(onAdd).toHaveBeenCalledTimes(1);
    const arg = onAdd.mock.calls[0][0];
    // 必须是绝对路径（以 / 或盘符开头）
    expect(arg).toMatch(/^(\/|[A-Za-z]:\\)/);
    // 必须以技能目录结尾（不含 SKILL.md）
    expect(arg).toMatch(/my-skill$/);
  });

  it("change 事件应触发 onAdd 并传递绝对路径", async () => {
    await dispatchAndSettle("change", "skills/my-skill/SKILL.md");

    expect(onAdd).toHaveBeenCalledTimes(1);
    const arg = onAdd.mock.calls[0][0];
    expect(arg).toMatch(/^(\/|[A-Za-z]:\\)/);
    expect(arg).toMatch(/my-skill$/);
  });

  // ── unlink 事件 ──

  it("unlink 事件应触发 onRemove 并传递小写 skill ID", () => {
    (watcher as any).dispatch("unlink", "skills/My-Skill/SKILL.md");

    // unlink 不下发 debounce，直接调用
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("my-skill");
  });

  // ── 多模式匹配 ──

  it("多个匹配模式时应选择最长前缀（防止嵌套误匹配）", async () => {
    const onAddSystem = jest.fn().mockResolvedValue(undefined);
    const onRemoveSystem = jest.fn();
    (watcher as any).handlers.set("skills/.system/test/*/SKILL.md", {
      onAdd: onAddSystem,
      onRemove: onRemoveSystem,
    });

    await dispatchAndSettle("add", "skills/.system/test/custom/SKILL.md");

    // 最长前缀 "skills/.system/test/" 优先于 "skills/" 和 ".system/"
    expect(onAddSystem).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled(); // 短的未触发
  });

  // ── 不匹配的事件 ──

  it("无关路径不应触发任何回调", async () => {
    await dispatchAndSettle("add", "other-dir/foo/SKILL.md");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("以点开头的目录应被忽略（隐藏目录）", async () => {
    await dispatchAndSettle("add", "skills/.hidden/SKILL.md");
    expect(onAdd).not.toHaveBeenCalled();
  });

  // ── debounce ──

  it("debounce 间隔内重复相同文件只触发一次 onAdd", () => {
    (watcher as any).dispatch("add", "skills/my-skill/SKILL.md");
    (watcher as any).dispatch("change", "skills/my-skill/SKILL.md"); // 同目录，debounce 重置
    (watcher as any).dispatch("change", "skills/my-skill/SKILL.md");

    // debounce 300ms 内不应触发
    expect(onAdd).not.toHaveBeenCalled();

    // 快进 300ms，应触发一次
    jest.advanceTimersByTime(300);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  // ── 路径处理 ──

  it("连续触发后 onAdd 收到绝对路径可被 path.resolve 安全使用", async () => {
    const nodePath = require("path");

    await dispatchAndSettle("add", "skills/my-skill/SKILL.md");

    const dirArg = onAdd.mock.calls[0][0];
    // path.resolve 后应与原值一致（已经是绝对路径）
    expect(nodePath.resolve(dirArg)).toBe(dirArg);
  });
});
