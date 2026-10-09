import {
  WINDOWS_GIT_BASH_PATHS,
  classifyShellOverride,
  pathExecutableCandidates,
  resolveWindowsShell,
} from "../../src/modules/shell/windows-shell-detect";

/** 用一组"存在的路径"造 exists 探针（大小写不敏感，模拟 Windows 文件系统） */
function fakeExists(paths: readonly string[]) {
  const normalized = new Set(paths.map((p) => p.toLowerCase()));
  const calls: string[] = [];
  const exists = (candidate: string) => {
    calls.push(candidate);
    return normalized.has(candidate.toLowerCase());
  };
  return { exists, calls };
}

const PROGRAM_FILES_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const PROGRAM_FILES_X86_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
const SYSTEM_PS =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

describe("resolveWindowsShell", () => {
  it("固定安装路径命中 Git Bash（Program Files 优先于 x86）", () => {
    const { exists } = fakeExists([PROGRAM_FILES_BASH, PROGRAM_FILES_X86_BASH]);

    const resolved = resolveWindowsShell({ env: { PATH: "" }, exists });

    expect(resolved.kind).toBe("gitbash");
    expect(resolved.path).toBe(PROGRAM_FILES_BASH);
    expect(resolved.source).toContain("default install path");
  });

  it("Program Files 缺失时命中 x86 安装路径", () => {
    const { exists } = fakeExists([PROGRAM_FILES_X86_BASH]);

    const resolved = resolveWindowsShell({ env: { PATH: "" }, exists });

    expect(resolved.kind).toBe("gitbash");
    expect(resolved.path).toBe(PROGRAM_FILES_X86_BASH);
  });

  it("默认安装布局（git.exe 在 Git\\cmd）解析为 Git\\bin\\bash.exe", () => {
    const { exists } = fakeExists([
      "C:\\Program Files\\Git\\cmd\\git.exe",
      PROGRAM_FILES_BASH,
    ]);

    const resolved = resolveWindowsShell({
      env: { PATH: "C:\\Program Files\\Git\\cmd" },
      exists,
    });

    expect(resolved.kind).toBe("gitbash");
    expect(resolved.path).toBe(PROGRAM_FILES_BASH);
  });

  it("git.exe 位于 Git\\mingw64\\bin 时按 ..\\..\\bin 反推到 Git\\bin\\bash.exe", () => {
    const { exists } = fakeExists([
      "D:\\tools\\git\\mingw64\\bin\\git.exe",
      "D:\\tools\\git\\bin\\bash.exe",
    ]);

    const resolved = resolveWindowsShell({
      env: { PATH: "D:\\tools\\git\\mingw64\\bin" },
      exists,
    });

    expect(resolved.kind).toBe("gitbash");
    expect(resolved.path).toBe("D:\\tools\\git\\bin\\bash.exe");
    expect(resolved.source).toContain("inferred from");
  });

  it("git.exe 位于自定义目录时按同样规则反推", () => {
    const { exists } = fakeExists([
      "D:\\tools\\git\\cmd\\git.exe",
      "D:\\tools\\git\\bin\\bash.exe",
    ]);

    const resolved = resolveWindowsShell({ env: { PATH: "D:\\tools\\git\\cmd" }, exists });

    expect(resolved.kind).toBe("gitbash");
    expect(resolved.path).toBe("D:\\tools\\git\\bin\\bash.exe");
  });

  it("PATH 键名大小写不敏感，且按 PATHEXT 尝试扩展名", () => {
    const { exists } = fakeExists([
      "D:\\tools\\git\\cmd\\git.exe",
      "D:\\tools\\git\\bin\\bash.exe",
    ]);

    const resolved = resolveWindowsShell({
      // 故意用 Path（Windows 上 PATH/Path 都可能出现）
      env: { Path: "D:\\other;D:\\tools\\git\\cmd", PATHEXT: ".EXE;.CMD" },
      exists,
    });

    expect(resolved.kind).toBe("gitbash");
    expect(resolved.path).toBe("D:\\tools\\git\\bin\\bash.exe");
  });

  it("未安装 Git 时回退 PowerShell（POWERSHELL env 优先）", () => {
    const { exists } = fakeExists([
      "C:\\custom\\powershell.exe",
      SYSTEM_PS,
    ]);

    const resolved = resolveWindowsShell({
      env: { PATH: "", POWERSHELL: "C:\\custom\\powershell.exe" },
      exists,
    });

    expect(resolved.kind).toBe("powershell");
    expect(resolved.path).toBe("C:\\custom\\powershell.exe");
    expect(resolved.source).toContain("POWERSHELL env");
  });

  it("未安装 Git 时回退到系统自带 PowerShell", () => {
    const { exists } = fakeExists([SYSTEM_PS]);

    const resolved = resolveWindowsShell({
      env: { SystemRoot: "C:\\Windows", PATH: "" },
      exists,
    });

    expect(resolved.kind).toBe("powershell");
    expect(resolved.path).toBe(SYSTEM_PS);
    expect(resolved.source).toContain("system");
  });

  it("系统路径也没有时用 PATH 中的 powershell.exe", () => {
    const { exists } = fakeExists(["E:\\bin\\powershell.exe"]);

    const resolved = resolveWindowsShell({
      env: { SystemRoot: "C:\\Windows", PATH: "E:\\bin" },
      exists,
    });

    expect(resolved.kind).toBe("powershell");
    expect(resolved.path).toBe("E:\\bin\\powershell.exe");
    expect(resolved.source).toContain("PATH");
  });

  it("全都没有时兜底 cmd.exe", () => {
    const { exists } = fakeExists([]);

    const resolved = resolveWindowsShell({ env: { PATH: "" }, exists });

    expect(resolved.kind).toBe("cmd");
    expect(resolved.path).toBe("");
    expect(resolved.source).toContain("cmd.exe");
  });

  describe("GUADA_SHELL 显式覆盖", () => {
    it("bash 路径 → gitbash，且优先于自动探测到的固定路径", () => {
      const { exists } = fakeExists(["D:\\msys\\bash.exe", PROGRAM_FILES_BASH]);

      const resolved = resolveWindowsShell({
        env: { GUADA_SHELL: "D:\\msys\\bash.exe", PATH: "" },
        exists,
      });

      expect(resolved.kind).toBe("gitbash");
      expect(resolved.path).toBe("D:\\msys\\bash.exe");
      expect(resolved.source).toBe("GUADA_SHELL override");
    });

    it("powershell 路径 → powershell（即使装了 Git Bash）", () => {
      const { exists } = fakeExists([PROGRAM_FILES_BASH, "C:\\pwsh\\powershell.exe"]);

      const resolved = resolveWindowsShell({
        env: { GUADA_SHELL: "C:\\pwsh\\powershell.exe", PATH: "" },
        exists,
      });

      expect(resolved.kind).toBe("powershell");
      expect(resolved.path).toBe("C:\\pwsh\\powershell.exe");
    });

    it("cmd 路径 → cmd", () => {
      const { exists } = fakeExists([PROGRAM_FILES_BASH, "C:\\Windows\\System32\\cmd.exe"]);

      const resolved = resolveWindowsShell({
        env: { GUADA_SHELL: "C:\\Windows\\System32\\cmd.exe", PATH: "" },
        exists,
      });

      expect(resolved.kind).toBe("cmd");
    });

    it("文件不存在时忽略覆盖，继续自动探测", () => {
      const { exists } = fakeExists([PROGRAM_FILES_BASH]);

      const resolved = resolveWindowsShell({
        env: { GUADA_SHELL: "D:\\missing\\bash.exe", PATH: "" },
        exists,
      });

      expect(resolved.kind).toBe("gitbash");
      expect(resolved.path).toBe(PROGRAM_FILES_BASH);
      expect(resolved.source).not.toBe("GUADA_SHELL override");
    });

    it("无法识别的 shell 名忽略覆盖", () => {
      const { exists } = fakeExists(["D:\\bin\\weird-shell.exe", SYSTEM_PS]);

      const resolved = resolveWindowsShell({
        env: { GUADA_SHELL: "D:\\bin\\weird-shell.exe", SystemRoot: "C:\\Windows", PATH: "" },
        exists,
      });

      expect(resolved.kind).toBe("powershell");
    });
  });

  it("固定 Git Bash 路径清单与 zcode 保持一致（两种 Program Files 布局）", () => {
    expect([...WINDOWS_GIT_BASH_PATHS]).toEqual([
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ]);
  });
});

describe("pathExecutableCandidates", () => {
  it("按 PATH 目录顺序 × （裸名 → PATHEXT 小写扩展名）展开", () => {
    const candidates = pathExecutableCandidates("git", {
      PATH: "C:\\a;C:\\b",
      PATHEXT: ".EXE;.CMD",
    });

    expect(candidates).toEqual([
      "C:\\a\\git",
      "C:\\a\\git.exe",
      "C:\\a\\git.cmd",
      "C:\\b\\git",
      "C:\\b\\git.exe",
      "C:\\b\\git.cmd",
    ]);
  });

  it("已带扩展名时不追加 PATHEXT；PATH 项两侧引号会被剥掉", () => {
    const candidates = pathExecutableCandidates("powershell.exe", {
      PATH: '"C:\\Program Files\\PowerShell";',
      PATHEXT: ".EXE",
    });

    expect(candidates).toEqual(["C:\\Program Files\\PowerShell\\powershell.exe"]);
  });

  it("PATHEXT 缺失时使用 Windows 默认扩展名", () => {
    const candidates = pathExecutableCandidates("git", { PATH: "C:\\a" });

    expect(candidates).toEqual([
      "C:\\a\\git",
      "C:\\a\\git.com",
      "C:\\a\\git.exe",
      "C:\\a\\git.bat",
      "C:\\a\\git.cmd",
    ]);
  });
});

describe("classifyShellOverride", () => {
  it("空值或文件不存在时返回 null", () => {
    const { exists } = fakeExists([]);
    expect(classifyShellOverride(undefined, exists)).toBeNull();
    expect(classifyShellOverride("C:\\nope\\bash.exe", exists)).toBeNull();
  });
});
