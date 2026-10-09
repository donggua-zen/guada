import {
  CommandApprovalMemory,
  evaluateCommand,
  normalizeCommandKey,
} from "../../src/common/services/command-policy";

/** 便捷断言：以 Git Bash（POSIX）为执行壳 */
const bash = (command: string) => evaluateCommand({ command, shellKind: "gitbash" });
/** 便捷断言：以 PowerShell 为执行壳 */
const ps = (command: string) => evaluateCommand({ command, shellKind: "powershell" });

describe("command-policy / POSIX 白名单正例（应放行）", () => {
  const allowed: readonly string[] = [
    "ls",
    "ls -la",
    "ls -la src/",
    "cat package.json",
    "cat -n file.txt",
    "head -n 20 README.md",
    "tail -5 log.txt",
    "wc -l src/index.ts",
    "stat file.txt",
    "pwd",
    "echo hello world",
    "printf '%s\\n' a b",
    "which git",
    "type node",
    "sort -k2 file.txt",
    "uniq -c file.txt",
    "cut -d, -f1 x.csv",
    "tr a-z A-Z",
    "rg TODO src",
    'grep -rn "foo" src',
    "find . -name '*.ts' -type f",
    "find src -maxdepth 2 -type d",
    "sed -n '1,10p' file.txt",
    "git status",
    "git status --porcelain",
    "git diff --stat",
    "git log --oneline -5",
    "git show HEAD",
    "git rev-parse --show-toplevel",
    "git ls-files",
    "git branch -a",
    "git branch --list",
    "git tag -l",
    "git remote -v",
    "git stash list",
    "git stash show",
    "git reflog show",
    "git worktree list",
    "git config --get user.name",
    "git config user.name",
    "git config --list",
    "git describe --tags",
    "git blame src/index.ts",
    "git grep TODO",
    "git --no-pager log -3",
    "node --version",
    "python --version",
    "npm ls",
    "npm --version",
    "dotnet --version",
    "go version",
    // 段与段：每段都在白名单内 + 管道
    "git status && git diff --stat",
    "cat file.txt | grep foo | head -3",
    "ls -la; git status",
    // 允许的"写黑洞"重定向与 fd 复制
    "ls > /dev/null",
    "git status 2> /dev/null",
    "git status 2>&1",
    "echo hi > /dev/null 2>&1",
    // 紧贴分隔符的重定向写法（历史命令里很常见）
    "git status 2>&1; git diff --stat",
    "git status 2>nul; git diff --stat",
    "where python 2>nul",
    "ls > NUL",
    "cat < a.txt; git status",
    // 纯注释 = 无操作
    "# 排查步骤",
    // 新增只读工具
    "systeminfo",
    "netstat -ano",
    "tasklist",
    'findstr /s "TODO" *.ts',
    "where python",
    "docker ps",
    "docker images",
    "docker inspect abc123",
  ];

  it.each(allowed)("%s", (command) => {
    const decision = bash(command);
    expect(decision.kind).toBe("whitelisted");
  });
});

describe("command-policy / POSIX 绕过样本（不得放行）", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    // [命令, 期望原因码]
    ["rm -rf /tmp/x", "unknown-command"],
    ["mv a b", "unknown-command"],
    ["cp a b", "unknown-command"],
    ["mkdir x", "unknown-command"],
    ["touch x", "unknown-command"],
    ["chmod 777 x", "unknown-command"],
    ["kill -9 1", "unknown-command"],
    ["curl http://example.com", "unknown-command"],
    ["wget http://example.com", "unknown-command"],
    ["ipconfig /release", "unknown-command"],
    ["arp -d 1.1.1.1", "unknown-command"],
    ["route delete 0.0.0.0", "unknown-command"],
    ["attrib +h file.txt", "unknown-command"],
    ["tee out.txt", "unknown-command"],
    ["xargs rm", "unknown-command"],
    ["awk '{print $1}' f.txt", "unverifiable-syntax"],
    ['python -c "import os; os.system(\'rm -rf /\')"', "unknown-command"],
    ['node -e "require(\'fs\').unlinkSync(\'x\')"', "unknown-command"],
    ["env rm -rf /", "unknown-command"],
    ["dxargs ls", "unknown-command"],
    // 白名单命令的写形态
    ["find . -delete", "write-signal"],
    ["find . -exec rm {} ;", "write-signal"],
    ["find . -fprint out.txt", "write-signal"],
    ["sed -i 's/a/b/' f.txt", "write-signal"],
    ["sed -i.bak 's/a/b/' f.txt", "write-signal"],
    ["sed 'w out.txt' f.txt", "write-signal"],
    ["sort -o out.txt in.txt", "write-signal"],
    ["sort --output=out.txt in.txt", "write-signal"],
    ["uniq in.txt out.txt", "unknown-command"],
    ["tail -f log.txt", "write-signal"],
    ["date -s 12:00", "write-signal"],
    ["tree -o out.txt", "write-signal"],
    // 重定向落盘
    ["echo hi > out.txt", "write-signal"],
    ["echo hi >> out.txt", "write-signal"],
    ["ls 2> err.txt", "write-signal"],
    ["git log > log.txt", "write-signal"],
    // 动态构造
    ["cat $(find . -name x)", "unverifiable-syntax"],
    ["ls `pwd`", "unverifiable-syntax"],
    ["echo $HOME", "unverifiable-syntax"],
    ["echo ${HOME}", "unverifiable-syntax"],
    ["cat <(ls)", "unverifiable-syntax"],
    ["ls {a,b}", "unverifiable-syntax"],
    ["(cd /tmp && ls)", "unverifiable-syntax"],
    ["ls &", "unverifiable-syntax"],
    ['ls "unterminated', "unverifiable-syntax"],
    // git 写形态与危险全局开关
    ["git push", "unknown-command"],
    ["git commit -m x", "unknown-command"],
    ["git checkout main", "unknown-command"],
    ["git reset --hard", "unknown-command"],
    ["git clean -fd", "unknown-command"],
    ["git config user.name someone", "unknown-command"],
    ["git stash drop", "unknown-command"],
    ["git stash pop", "unknown-command"],
    ["git remote add origin url", "unknown-command"],
    ["git remote prune origin", "unknown-command"],
    ["git worktree add ../x", "unknown-command"],
    ["git reflog delete", "unknown-command"],
    ["git branch -d feature", "unknown-command"],
    ["git branch newbranch", "unknown-command"],
    ["git tag -d v1", "unknown-command"],
    ["git tag v1.0", "unknown-command"],
    ["git log --output=log.txt", "write-signal"],
    ["git diff --output=diff.txt", "write-signal"],
    ["git -c core.pager=cat log", "write-signal"],
    ["git -C /tmp status", "write-signal"],
    ["git --work-tree=/tmp status", "write-signal"],
    // 解释器只允许报版本
    ["node script.js", "unknown-command"],
    ['python -m pip install requests', "unknown-command"],
    ["npm install", "unknown-command"],
    ["npm run build", "unknown-command"],
    ["go run main.go", "unknown-command"],
    ["go env -w GOFLAGS=-mod=mod", "unknown-command"],
    ["dotnet build", "unknown-command"],
    // 多段里夹一个非白名单段
    "ls && rm -rf tmp",
    "cat f.txt | tee out.txt",
    "git status; git push",
    "ls; echo $(pwd)",
  ].map(([command, code]) => [command, code] as const);

  it.each(cases)("%s", (command, _code) => {
    const decision = bash(command);
    expect(decision.kind).toBe("needs-approval");
  });

  it.each([
    ["find . -delete", "write-signal"],
    ["sed -i 's/a/b/' f", "write-signal"],
    ["echo hi > out.txt", "write-signal"],
    ["rm -rf x", "unknown-command"],
    ["git push", "unknown-command"],
    ["echo $HOME", "unverifiable-syntax"],
    ["cat $(ls)", "unverifiable-syntax"],
  ])("原因码分流：%s → %s", (command, code) => {
    const decision = bash(command);
    expect(decision.kind).toBe("needs-approval");
    if (decision.kind === "needs-approval") {
      expect(decision.code).toBe(code);
    }
  });
});

describe("command-policy / PowerShell 判定", () => {
  it.each([
    "Get-ChildItem",
    "Get-ChildItem -Recurse -Force",
    "ls -Recurse",
    "dir",
    "gci",
    "Get-Content file.txt",
    "Get-Content -Path file.txt -TotalCount 20",
    "cat file.txt",
    "type file.txt",
    "Select-String -Path src/**/*.ts -Pattern foo",
    "sls -Pattern TODO",
    "Get-Item .",
    "gi .",
    "Get-Process",
    "ps",
    "gps -Name node",
    "Test-Path src",
    "Resolve-Path .",
    "Split-Path -Parent x",
    "Get-Location",
    "pwd",
    "Measure-Object",
    "measure -Line",
    "Sort-Object Name",
    "sort",
    "Select-Object -First 5",
    "Format-Table -AutoSize",
    "ft",
    "Out-String",
    "ConvertTo-Json",
    "Write-Output hello",
    "echo hello",
    "Get-Date",
    "Get-Command git",
    "Get-Member",
    "Get-Help Get-ChildItem",
    "Get-Acl .",
    "Start-Sleep -Seconds 1",
    "cd src",
    "Set-Location src",
  ])("白名单：%s", (command) => {
    expect(ps(command).kind).toBe("whitelisted");
  });

  it.each([
    "Remove-Item x",
    "rm x",
    "rm -Recurse -Force x",
    "del x",
    "erase x",
    "rd x",
    "Set-Content file.txt hi",
    "sc file.txt hi",
    "Add-Content file.txt hi",
    "ac file.txt hi",
    "Clear-Content file.txt",
    "Out-File out.txt",
    "New-Item -ItemType File x",
    "ni x -ItemType File",
    "md newdir",
    "mkdir newdir",
    "Move-Item a b",
    "mv a b",
    "Copy-Item a b",
    "cp a b",
    "Rename-Item a b",
    "ren a b",
    "Tee-Object -FilePath out.txt",
    "tee out.txt",
    "Start-Process notepad",
    "saps notepad",
    "Stop-Process -Name node",
    "kill 1234",
    "Invoke-WebRequest -Uri http://x -OutFile y",
    "curl http://x -OutFile y",
    "wget http://x",
    "Invoke-Expression 'rm x'",
    "iex 'rm x'",
    "Set-ExecutionPolicy Bypass",
    "Set-Acl -Path . -AclObject $acl",
    "New-PSDrive -Name X -PSProvider FileSystem -Root C:\\",
    "Get-Content a.txt | Set-Content b.txt",
    "Get-ChildItem | Remove-Item",
    "echo hi > out.txt",
    "Get-Content file.txt -Wait",
  ])("不得放行：%s", (command) => {
    const decision = ps(command);
    expect(decision.kind).toBe("needs-approval");
  });

  it.each([
    "Get-ChildItem $env:TEMP",
    "$x = Get-Date",
    "[System.IO.File]::Delete('x')",
    "Get-Process | Where-Object { $_.Name -eq 'node' }",
    'powershell -EncodedCommand ZQBjAGgAbwA=',
    "& 'C:\\tools\\x.exe'",
    "@{a=1}",
    "Get-ChildItem (Get-Item .)",
  ])("不可核验：%s", (command) => {
    const decision = ps(command);
    expect(decision.kind).toBe("needs-approval");
  });
});

describe("command-policy / 双方言合成", () => {
  it("执行壳为 PowerShell 时，bash 风格命令经 POSIX 表放行", () => {
    // PowerShell 只是转交执行外部程序：ls -la 由 Get-ChildItem 别名接管，git status 走 POSIX 表
    expect(ps("git status").kind).toBe("whitelisted");
    expect(ps("git diff --stat").kind).toBe("whitelisted");
    expect(ps("ls -la").kind).toBe("whitelisted");
  });

  it("执行壳为 bash 时，另一方言的已知写操作仍触发审批（绊线）", () => {
    // Remove-Item 在 bash 里不存在（会报 command not found），但 PS 语义下是删除 → 保守拦下
    const decision = bash("Remove-Item -Recurse -Force x");
    expect(decision.kind).toBe("needs-approval");
  });

  it("cmd.exe 没有只读白名单 → 一律需审批", () => {
    const decision = evaluateCommand({ command: "dir", shellKind: "cmd" });
    expect(decision.kind).toBe("needs-approval");
    if (decision.kind === "needs-approval") {
      expect(decision.code).toBe("no-allowlist");
    }
  });
});

describe("command-policy / 诊断文案（拼进模型可见的英文消息）必须是纯 ASCII", () => {
  it.each([
    "mkdir -p /tmp/x",
    "rm -rf x",
    "echo hi > out.txt",
    "echo $HOME",
    "find . -delete",
    "sed -i 's/a/b/' f",
    "git push",
    "git -c core.pager=cat log",
    "git branch --bogus-flag",
    "git config --bogus",
  ])("%s", (command) => {
    const decision = bash(command);
    expect(decision.kind).toBe("needs-approval");
    if (decision.kind === "needs-approval") {
      expect(decision.reason).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it("cmd 无白名单的原因同样是英文", () => {
    const decision = evaluateCommand({ command: "dir", shellKind: "cmd" });
    expect(decision.kind).toBe("needs-approval");
    if (decision.kind === "needs-approval") {
      expect(decision.reason).toMatch(/^[\x20-\x7E]+$/);
    }
  });
});

describe("command-policy / 会话内审批记忆", () => {
  it("记住的命令在同一会话内命中，其它会话不命中", () => {
    const memory = new CommandApprovalMemory();
    memory.remember("sess-a", "npm run build");
    expect(memory.has("sess-a", "npm run build")).toBe(true);
    expect(memory.has("sess-a", "npm run test")).toBe(false);
    expect(memory.has("sess-b", "npm run build")).toBe(false);
  });

  it("空白差异归一，语义不同的命令不互相放行", () => {
    const memory = new CommandApprovalMemory();
    memory.remember("sess-a", "npm  run   build");
    expect(memory.has("sess-a", "npm run build")).toBe(true);
    expect(memory.has("sess-a", "npm run build --force")).toBe(false);
  });

  it("会话清理与容量上限", () => {
    const memory = new CommandApprovalMemory();
    memory.remember("sess-a", "cmd-1");
    memory.forgetSession("sess-a");
    expect(memory.has("sess-a", "cmd-1")).toBe(false);

    for (let i = 0; i < 250; i++) memory.remember("sess-b", `cmd-${i}`);
    expect(memory.has("sess-b", "cmd-249")).toBe(true);
    expect(memory.has("sess-b", "cmd-0")).toBe(false);
  });

  it("normalizeCommandKey：折叠空白、去首尾", () => {
    expect(normalizeCommandKey("  git   status \n")).toBe("git status");
  });
});
