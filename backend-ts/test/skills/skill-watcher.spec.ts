import { SkillWatcherService } from "../../src/modules/skills/core/skill-watcher.service";
import * as path from "path";

// ===========================================================================
// 单元测试：验证 dispatch 的路径匹配逻辑
//
// 注意：这些测试直接调用 dispatch() 而非经过 chokidar，因为 chokidar
// 在 CI/Windows 上的行为不可预测。但 dispatch() 是 chokidar 事件触发的
// 实际处理函数，测试覆盖了所有生产场景的路径组合：
// 1. 相对 handler key + 相对 filePath（通用场景）
// 2. 绝对 handler key + 绝对 filePath（Windows addWatch 场景）
// 3. 绝对 handler key + 相对 filePath（chokidar 可能发出相对路径）
// 4. 混合分隔符（Windows path.join + 字面量 /*/）
// 5. unlink / unlinkDir 事件
// ===========================================================================

describe("SkillWatcherService.dispatch", () => {
  let watcher: SkillWatcherService;
  let onAdd: jest.Mock;
  let onRemove: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    watcher = new SkillWatcherService();
    onAdd = jest.fn().mockResolvedValue(undefined);
    onRemove = jest.fn();

    // 注入 handlers（绕过 chokidar，直接测试 dispatch）
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

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("my-skill");
  });

  // ── unlinkDir 事件 ──

  it("unlinkDir 事件应触发 onRemove", () => {
    (watcher as any).dispatch("unlinkDir", "skills/My-Dir");

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("my-dir");
  });

  it("unlinkDir 绝对路径应触发 onRemove", () => {
    (watcher as any).handlers.set("D:\\skills\\*/SKILL.md", { onAdd, onRemove });
    (watcher as any).dispatch("unlinkDir", "D:\\skills\\another-skill");

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("another-skill");
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
    (watcher as any).dispatch("change", "skills/my-skill/SKILL.md");
    (watcher as any).dispatch("change", "skills/my-skill/SKILL.md");

    expect(onAdd).not.toHaveBeenCalled(); // debounce 300ms 内

    jest.advanceTimersByTime(300);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  // ── 路径处理 ──

  it("add 后 onAdd 收到绝对路径可被 path.resolve 安全使用", async () => {
    await dispatchAndSettle("add", "skills/my-skill/SKILL.md");

    const dirArg = onAdd.mock.calls[0][0];
    expect(path.resolve(dirArg)).toBe(dirArg);
  });

  // ── 生产场景：绝对路径 pattern（addWatch 的实际行为） ──

  it("绝对路径 pattern + 绝对路径 filePath（标准 Windows 场景）", async () => {
    (watcher as any).handlers.set(
      "D:\\AI\\ai_chat\\backend-ts\\skills/*/SKILL.md",
      { onAdd, onRemove }
    );
    await dispatchAndSettle(
      "add",
      "D:\\AI\\ai_chat\\backend-ts\\skills\\my-skill\\SKILL.md"
    );

    expect(onAdd).toHaveBeenCalledTimes(1);
    const arg = onAdd.mock.calls[0][0];
    expect(arg).toMatch(/my-skill$/);
  });

  it("绝对路径 pattern + 相对 filePath（chokidar 可能发出相对路径）", async () => {
    (watcher as any).handlers.set(
      "D:\\AI\\ai_chat\\backend-ts\\skills\\*/SKILL.md",
      { onAdd, onRemove }
    );
    await dispatchAndSettle("add", "skills/my-skill/SKILL.md");

    expect(onAdd).toHaveBeenCalledTimes(1);
    const arg = onAdd.mock.calls[0][0];
    expect(arg).toMatch(/my-skill$/);
  });

  it("绝对路径 pattern + 相对 unlink 路径", async () => {
    (watcher as any).handlers.set(
      "D:\\AI\\ai_chat\\backend-ts\\skills\\*/SKILL.md",
      { onAdd, onRemove }
    );
    (watcher as any).dispatch("unlink", "skills/My-Skill/SKILL.md");

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("my-skill");
  });
});