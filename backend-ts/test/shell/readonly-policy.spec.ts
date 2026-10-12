/**
 * 只读档（名单制）：出厂名单 + 你的改动 —— 删一条 = 拒绝，加一条 = 放行（有代码兜底）。
 *
 * 只读档**不弹窗**：ask 与 deny 一律按拒绝处理（包括敏感路径）。
 */
import {
  builtinReadOnlySet,
  evaluateCommand,
  factoryRules,
  loadFactoryPolicy,
} from "../../src/common/services/command-policy";
import type { EffectivePolicy, PolicyRule } from "../../src/common/services/command-policy";

function policyWith(opts: { user?: PolicyRule[]; removed?: string[]; noFactory?: boolean } = {}): EffectivePolicy {
  const factory = loadFactoryPolicy();
  return {
    userRules: opts.user ?? [],
    factoryRules: opts.noFactory ? [] : factoryRules(factory),
    readOnly: { factory: factory.readOnly, removed: opts.removed ?? [], builtin: builtinReadOnlySet() },
  };
}

function evaluate(
  command: string,
  policy: EffectivePolicy,
  shellKind: "gitbash" | "powershell" = "gitbash",
) {
  return evaluateCommand({ command, shellKind, mode: "read-only", policy });
}

describe("只读档：名单制（默认拒绝）", () => {
  it("出厂名单内的命令放行（POSIX / git / PowerShell 三种形态）", () => {
    const policy = policyWith();
    expect(evaluate("cat notes.txt", policy).kind).toBe("whitelisted");
    expect(evaluate("ls -la", policy).kind).toBe("whitelisted");
    expect(evaluate("git status -s", policy).kind).toBe("whitelisted");
    expect(evaluate("git --no-pager log -1", policy).kind).toBe("whitelisted");
    expect(evaluate("find . -name '*.ts'", policy).kind).toBe("whitelisted");
    expect(evaluate("node --version", policy).kind).toBe("whitelisted");
    expect(evaluate("ls -la", policy, "powershell").kind).toBe("whitelisted");
    expect(evaluate("Get-ChildItem -Recurse", policy, "powershell").kind).toBe("whitelisted");
    expect(evaluate("ls && cat notes.txt", policy).kind).toBe("whitelisted");
    expect(evaluate("# 排查步骤", policy).kind).toBe("whitelisted");
  });

  it("不在名单内的命令一律拒绝（不弹窗）", () => {
    const policy = policyWith();
    for (const command of ["rm build -rf", "ffmpeg -i in.mp4 out.mp4", "curl https://x"]) {
      expect(evaluate(command, policy)).toMatchObject({ kind: "denied", code: "not-whitelisted" });
    }
    expect(evaluate("npm install", policy)).toMatchObject({ kind: "denied", code: "not-whitelisted" });
    expect(evaluate("ls && rm build -rf", policy).kind).toBe("denied");
    expect(evaluate("cat x", policy, "cmd" as any).kind).toBe("denied");
  });

  it("readOnlyRemove：划掉的出厂条目被拒绝（删一行 = 收紧）", () => {
    const policy = policyWith({ removed: ["cat", "git status"] });
    expect(evaluate("cat notes.txt", policy)).toMatchObject({ kind: "denied", code: "not-whitelisted" });
    expect(evaluate("git status", policy)).toMatchObject({ kind: "denied", code: "not-whitelisted" });
    expect(evaluate("ls -la", policy).kind).toBe("whitelisted");
  });

  it("用户 allow 规则 = 扩展只读名单（自加条目）", () => {
    const policy = policyWith({
      user: [
        { action: "allow", match: "ffmpeg *" },
        { action: "allow", match: "make *" },
      ],
    });
    expect(evaluate("ffmpeg -i in.mp4 out.mp4", policy).kind).toBe("whitelisted");
    expect(evaluate("make -j8", policy).kind).toBe("whitelisted");
  });

  it("自加条目的代码兜底：rm / ssh / taskkill / mkfs 仍然拒绝", () => {
    const policy = policyWith({
      user: [
        { action: "allow", match: "rm *" },
        { action: "allow", match: "ssh *" },
        { action: "allow", match: "taskkill *" },
        { action: "allow", match: "mkfs *" },
      ],
    });
    expect(evaluate("rm build -rf", policy)).toMatchObject({ kind: "denied", code: "blocked-floor" });
    expect(evaluate("ssh host uptime", policy)).toMatchObject({ kind: "denied", code: "blocked-floor" });
    expect(evaluate("taskkill /IM foo.exe", policy)).toMatchObject({ kind: "denied", code: "blocked-floor" });
    expect(evaluate("mkfs.ext4 /dev/sdb1", policy)).toMatchObject({ kind: "denied", code: "catastrophic" });
  });

  it("用户 deny / ask 规则：只读档一律拒绝（ask 也不弹窗）", () => {
    expect(evaluate("cat x", policyWith({ user: [{ action: "deny", match: "cat *" }] }))).toMatchObject({
      kind: "denied",
      code: "user-deny",
    });
    expect(evaluate("cat x", policyWith({ user: [{ action: "ask", match: "cat *" }] }))).toMatchObject({
      kind: "denied",
      code: "not-whitelisted",
    });
  });

  it("敏感路径：只读档直接拒绝（提示去设置页放通或切档）", () => {
    const policy = policyWith();
    const sshKey = evaluate("cat ~/.ssh/id_rsa", policy);
    expect(sshKey).toMatchObject({ kind: "denied", code: "sensitive-path" });
    expect(evaluate("type .env", policy, "powershell")).toMatchObject({
      kind: "denied",
      code: "sensitive-path",
    });
  });

  it("内置条目仍走参数级核验（find 放行，find -delete 拒绝）", () => {
    const policy = policyWith();
    expect(evaluate("find . -delete", policy)).toMatchObject({ kind: "denied", code: "unsafe-flags" });
    expect(evaluate("sed -i 's/a/b/' f.txt", policy)).toMatchObject({ kind: "denied", code: "unsafe-flags" });
    expect(evaluate("echo hi > out.txt", policy)).toMatchObject({ kind: "denied", code: "write-signal" });
    expect(evaluate("Get-Content -Wait log.txt", policy, "powershell")).toMatchObject({
      kind: "denied",
      code: "unsafe-flags",
    });
    expect(evaluate("python --version extra", policy)).toMatchObject({
      kind: "denied",
      code: "unknown-command",
    });
  });

  it("只认特定形态的工具：具体形态放行，任意参数/执行器形态拒绝", () => {
    const policy = policyWith();
    expect(evaluate("python --version", policy).kind).toBe("whitelisted");
    expect(evaluate("node -V", policy).kind).toBe("whitelisted");
    expect(evaluate("docker ps", policy).kind).toBe("whitelisted");
    expect(evaluate("docker container ls", policy).kind).toBe("whitelisted");
    expect(evaluate("python write.py", policy)).toMatchObject({ kind: "denied" });
    expect(evaluate("docker container run --privileged alpine", policy)).toMatchObject({ kind: "denied" });
  });

  it("项目级规则优先（userRules 顺序即优先级）", () => {
    const policy = policyWith({
      user: [
        { action: "allow", match: "ffmpeg *" }, // 项目级
        { action: "ask", match: "ffmpeg *" }, // 全局级
      ],
    });
    expect(evaluate("ffmpeg -i a.mp4 b.mp4", policy).kind).toBe("whitelisted");
  });

  it("没有出厂名单（极端情况）→ 什么都跑不了", () => {
    const policy = policyWith({ noFactory: true });
    policy.readOnly = { factory: [], removed: [], builtin: builtinReadOnlySet() };
    expect(evaluate("cat notes.txt", policy)).toMatchObject({ kind: "denied" });
    expect(evaluate("ls", policy)).toMatchObject({ kind: "denied" });
  });

  it("只读档只产生 放行 / 拒绝 两种结论（不会挂起等审批）", () => {
    const policy = policyWith();
    for (const command of ["ls", "rm -rf build", "curl x", "Get-ChildItem", "npm publish"]) {
      expect(evaluate(command, policy).kind).not.toBe("needs-approval");
    }
  });
});
