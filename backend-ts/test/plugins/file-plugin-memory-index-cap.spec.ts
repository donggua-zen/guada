/**
 * FilePlugin 记忆索引（MEMORY.md）上限守卫。
 *
 * 契约（与 engramory 的 cap hook 同构）：
 * - 只对**会话自己的索引路径**生效：工作区别处的同名 MEMORY.md、记忆目录里的明细文件都不受限；
 * - 只有"结果超硬上限（行或字节）**且**比当前文件更长"才拒绝 → 缩小/持平永远放行（可增量瘦身）；
 * - 索引不存在视为空 → 首次就写超限被拒；
 * - 超软上限未超硬 → 放行但在工具结果里附带整理提醒；
 * - 与牢笼/安全档位正交：read-only 会话内的记忆写入（本就允许）同样受限。
 * 用真实 WorkspaceService 与真实 PolicyRulesService 替身；AskService 不应被触达。
 */
import { policyRulesStub } from "../helpers/policy-rules-stub";
import { PolicyRulesService } from "../../src/common/services/policy-rules.service";
import { Test, TestingModule } from "@nestjs/testing";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FilePlugin } from "../../src/modules/plugins/builtins/file.plugin";
import { WorkspaceService } from "../../src/common/services/workspace.service";
import { WorkspaceToolRouter } from "../../src/modules/remote-workspace/workspace-router";
import { AskService } from "../../src/common/services/ask.service";
import { writeApprovalMemory } from "../../src/common/services/write-approval-memory";
import {
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_INDEX_SOFT_LINES,
  countIndexLines,
} from "../../src/common/utils/memory-path.util";

function capturePluginApi(): any {
  const tools: any[] = [];
  return {
    tools,
    registerTool: (def: any) => tools.push(def),
    registerRawTool: (def: any) => tools.push(def),
    registerPrompt: () => {},
    registerNls: () => {},
    registerToolKit: () => ({
      registerTool: (def: any) => tools.push(def),
      registerRawTool: (def: any) => tools.push(def),
      registerPrompt: () => {},
    }),
    registerCommandProvider: () => {},
  };
}

describe("FilePlugin 记忆索引上限守卫", () => {
  let plugin: FilePlugin;
  let api: any;
  let tmpDir: string;
  let indexAbs: string;

  const indexLines = (n: number, filler = "x") =>
    Array.from({ length: n }, (_, i) =>
      filler ? `entry-${i + 1} ${filler}` : `entry-${i + 1}`,
    ).join("\n");

  const webCtx = (sandbox: string = "workspace-write") =>
    ({
      session: {
        workspacePath: tmpDir,
        sessionId: "s1",
        sessionType: "web",
        getSandboxMode: () => sandbox,
        getPathJail: () => null,
        getSettings: () => ({}),
      },
    }) as any;

  const subAgentCtx = () =>
    ({
      session: {
        workspacePath: tmpDir,
        sessionId: "sub1",
        sessionType: "sub_agent",
        getSandboxMode: () => "workspace-write",
        getPathJail: () => null,
        getSettings: () => ({}),
      },
    }) as any;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-index-cap-"));
    indexAbs = path.join(tmpDir, ".guada", "memory", "MEMORY.md");
    writeApprovalMemory.clear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilePlugin,
        {
          provide: WorkspaceService,
          useValue: new WorkspaceService(
            {
              get: (key: string) =>
                key === "WORKSPACE_BASE_DIR"
                  ? path.join(tmpDir, "base")
                  : undefined,
            } as any,
            {} as any,
          ),
        },
        {
          provide: AskService,
          useValue: {
            requestApproval: jest.fn(() => {
              throw new Error("approval must not be requested");
            }),
            requestWriteApproval: jest.fn(() => {
              throw new Error("write approval must not be requested");
            }),
          },
        },
        { provide: PolicyRulesService, useValue: policyRulesStub() },
        { provide: WorkspaceToolRouter, useValue: { resolveRemoteTarget: async () => null } },
      ],
    }).compile();

    plugin = module.get<FilePlugin>(FilePlugin);
    api = capturePluginApi();
    await plugin.onLoad(api);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    writeApprovalMemory.clear();
  });

  function tool(name: string) {
    const t = api.tools.find((x: any) => x.name === name);
    if (!t) throw new Error(`tool ${name} not registered`);
    return t as { execute: (args: any, ctx: any) => Promise<any> };
  }

  async function seedIndex(content: string) {
    await fs.mkdir(path.dirname(indexAbs), { recursive: true });
    await fs.writeFile(indexAbs, content, "utf-8");
  }

  // ── 行数口径 ──

  describe("countIndexLines", () => {
    it("忽略末尾单个换行（与注入截断同口径）", () => {
      expect(countIndexLines(indexLines(MEMORY_INDEX_MAX_LINES) + "\n")).toBe(
        MEMORY_INDEX_MAX_LINES,
      );
      expect(countIndexLines(indexLines(3) + "\n")).toBe(3);
      expect(countIndexLines(indexLines(3))).toBe(3);
      expect(countIndexLines("")).toBe(1);
    });

    it("CRLF 按同一口径计行", () => {
      expect(countIndexLines("a\r\nb\r\nc\r\n")).toBe(3);
    });
  });

  // ── write ──

  describe("write", () => {
    it("恰好到硬上限（含末尾换行）放行，且不报溢出", async () => {
      const result = await tool("write").execute(
        { file_path: indexAbs, content: indexLines(MEMORY_INDEX_MAX_LINES) + "\n" },
        webCtx(),
      );
      expect(result).toContain("File written");
      // 200 行 + 末尾换行不能被算成 201 行（超软上限提示可以有，溢出提示不可以）
      expect(result).not.toContain("only the first");
    });

    it("首次写入就超硬上限 → 拒绝，且磁盘无文件", async () => {
      await expect(
        tool("write").execute(
          { file_path: indexAbs, content: indexLines(MEMORY_INDEX_MAX_LINES + 1) },
          webCtx(),
        ),
      ).rejects.toThrow(/hard cap/);
      await expect(fs.access(indexAbs)).rejects.toThrow();
    });

    it("已超上限时继续写更长 → 拒绝且文件未变", async () => {
      const before = indexLines(MEMORY_INDEX_MAX_LINES + 10);
      await seedIndex(before);
      await expect(
        tool("write").execute(
          { file_path: indexAbs, content: indexLines(MEMORY_INDEX_MAX_LINES + 15) },
          webCtx(),
        ),
      ).rejects.toThrow(/hard cap/);
      await expect(fs.readFile(indexAbs, "utf-8")).resolves.toBe(before);
    });

    it("已超上限时缩小 → 放行（可增量瘦身）", async () => {
      await seedIndex(indexLines(MEMORY_INDEX_MAX_LINES + 10));
      const result = await tool("write").execute(
        { file_path: indexAbs, content: indexLines(MEMORY_INDEX_MAX_LINES - 2) },
        webCtx(),
      );
      expect(result).toContain("File written");
      await expect(fs.readFile(indexAbs, "utf-8")).resolves.toBe(
        indexLines(MEMORY_INDEX_MAX_LINES - 2),
      );
    });

    it("已超上限时原样重写 → 放行（持平不算增长）", async () => {
      const before = indexLines(MEMORY_INDEX_MAX_LINES + 10);
      await seedIndex(before);
      const result = await tool("write").execute(
        { file_path: indexAbs, content: before },
        webCtx(),
      );
      expect(result).toContain("File written");
    });

    it("仅字节超限（行数未超）→ 拒绝", async () => {
      // 60 行 × 600 字节 ≈ 36KB > 25KB
      const longLines = indexLines(60, "y".repeat(600));
      expect(longLines.split("\n").length).toBeLessThan(MEMORY_INDEX_MAX_LINES);
      expect(Buffer.byteLength(longLines, "utf8")).toBeGreaterThan(MEMORY_INDEX_MAX_BYTES);

      await expect(
        tool("write").execute({ file_path: indexAbs, content: longLines }, webCtx()),
      ).rejects.toThrow(/bytes >/);
    });

    it("超软上限未超硬 → 放行并附带整理提醒", async () => {
      const result = await tool("write").execute(
        { file_path: indexAbs, content: indexLines(MEMORY_INDEX_SOFT_LINES + 5) },
        webCtx(),
      );
      expect(result).toContain("File written");
      expect(result).toContain("soft cap");
    });

    it("相对路径指向索引同样受限", async () => {
      await expect(
        tool("write").execute(
          {
            file_path: path.join(".guada", "memory", "MEMORY.md"),
            content: indexLines(MEMORY_INDEX_MAX_LINES + 1),
          },
          webCtx(),
        ),
      ).rejects.toThrow(/hard cap/);
    });
  });

  // ── edit ──

  describe("edit", () => {
    it("把索引推过上限 → 拒绝且文件未变", async () => {
      const before = indexLines(MEMORY_INDEX_MAX_LINES);
      await seedIndex(before);
      await expect(
        tool("edit").execute(
          {
            file_path: indexAbs,
            old_text: `entry-${MEMORY_INDEX_MAX_LINES}`,
            new_text: `entry-${MEMORY_INDEX_MAX_LINES}\nadded-line`,
          },
          webCtx(),
        ),
      ).rejects.toThrow(/hard cap/);
      await expect(fs.readFile(indexAbs, "utf-8")).resolves.toBe(before);
    });

    it("从超限索引里删条目 → 放行", async () => {
      await seedIndex(indexLines(MEMORY_INDEX_MAX_LINES + 5, ""));
      const result = await tool("edit").execute(
        {
          file_path: indexAbs,
          old_text: `\nentry-${MEMORY_INDEX_MAX_LINES + 5}`,
          new_text: "",
        },
        webCtx(),
      );
      expect(result).toContain("modified");
      await expect(fs.readFile(indexAbs, "utf-8")).resolves.toBe(
        indexLines(MEMORY_INDEX_MAX_LINES + 4, ""),
      );
    });
  });

  // ── 作用范围 ──

  describe("作用范围（只拦会话自己的索引）", () => {
    it("工作区别处的同名 MEMORY.md 不受限", async () => {
      const other = path.join(tmpDir, "docs", "MEMORY.md");
      const result = await tool("write").execute(
        { file_path: other, content: indexLines(MEMORY_INDEX_MAX_LINES + 50) },
        webCtx(),
      );
      expect(result).toContain("File written");
    });

    it("记忆目录内的明细文件不受限", async () => {
      const detail = path.join(tmpDir, ".guada", "memory", "notes", "big.md");
      const result = await tool("write").execute(
        { file_path: detail, content: indexLines(MEMORY_INDEX_MAX_LINES + 300) },
        webCtx(),
      );
      expect(result).toContain("File written");
    });

    it("子智能体走它自己的隔离索引路径", async () => {
      const subIndex = path.join(
        tmpDir,
        ".guada",
        "subagents",
        "sub1",
        "memory",
        "MEMORY.md",
      );
      await expect(
        tool("write").execute(
          { file_path: subIndex, content: indexLines(MEMORY_INDEX_MAX_LINES + 1) },
          subAgentCtx(),
        ),
      ).rejects.toThrow(/hard cap/);
      // 守卫按会话判定：子智能体上下文里，主会话索引不是"它的索引"，不受本守卫约束
      const mainResult = await tool("write").execute(
        { file_path: indexAbs, content: indexLines(MEMORY_INDEX_MAX_LINES + 1) },
        subAgentCtx(),
      );
      expect(mainResult).toContain("File written");
    });
  });

  // ── 与安全档位正交 ──

  describe("与安全档位正交", () => {
    it("read-only 会话内的记忆写入（本就允许）同样受上限约束", async () => {
      const allowed = await tool("write").execute(
        { file_path: indexAbs, content: indexLines(10) },
        webCtx("read-only"),
      );
      expect(allowed).toContain("File written");

      await expect(
        tool("write").execute(
          { file_path: indexAbs, content: indexLines(MEMORY_INDEX_MAX_LINES + 1) },
          webCtx("read-only"),
        ),
      ).rejects.toThrow(/hard cap/);
    });
  });
});
