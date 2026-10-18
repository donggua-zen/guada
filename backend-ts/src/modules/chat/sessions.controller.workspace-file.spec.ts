import { BadRequestException, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionsController } from "./sessions.controller";

/**
 * workspace/file 的错误语义：
 * - 文件不存在 → 404（此前抛普通 Error，被全局过滤器映射成 500）
 * - 目录当文件读 → 400
 * - 超过预览上限 → 413
 * 这些错误必须可区分，前端才能显示「文件不存在 / 文件过大」而不是通用加载失败。
 */
describe("SessionsController.getWorkspaceFile 错误语义", () => {
  let tmpDir: string;
  let controller: SessionsController;
  let session: { id: string; workspacePath: string };

  const callGetFile = (filePath: string, sniff?: string) =>
    controller.getWorkspaceFile(
      session.id,
      filePath,
      sniff,
      { headers: {} } as any,
      { setHeader: jest.fn(), json: jest.fn() } as any,
    );

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-file-spec-"));
    session = { id: "s1", workspacePath: tmpDir };

    const sessionService = {
      getSessionById: jest.fn().mockResolvedValue(session),
    };
    const workspaceService = {
      resolveSessionWorkspaceDir: jest.fn().mockResolvedValue(tmpDir),
      resolveFilePath: (filePath: string, workspaceDir: string) =>
        path.isAbsolute(filePath)
          ? path.normalize(filePath)
          : path.join(workspaceDir, filePath),
    };

    controller = new SessionsController(
      sessionService as any,
      workspaceService as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("文件不存在 → NotFoundException（404），不再是 500", async () => {
    await expect(callGetFile("_csv.py")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("目标为目录 → BadRequestException（400）", async () => {
    fs.mkdirSync(path.join(tmpDir, "dir.py"));
    await expect(callGetFile("dir.py")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("超过 5MB 的文本 → PayloadTooLargeException（413）", async () => {
    fs.writeFileSync(path.join(tmpDir, "big.py"), Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    await expect(callGetFile("big.py")).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it("正常文本 → 返回内容", async () => {
    fs.writeFileSync(path.join(tmpDir, "hello.py"), "print('hi')\n");
    const res = { setHeader: jest.fn(), json: jest.fn() } as any;

    await controller.getWorkspaceFile(
      session.id,
      "hello.py",
      undefined,
      { headers: {} } as any,
      res,
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "hello.py",
        name: "hello.py",
        content: "print('hi')\n",
        isBinary: false,
      }),
    );
  });
});
