import { FileService } from "./file.service";

/**
 * 附件上传的守卫测试
 *
 * 附件只落盘、不写 DB：上传返回内联 FileRef，随消息事件写进 JSONL。
 * 因此这里只校验「会话必须存在」这一条前置条件（单账户模型下无归属校验，
 * 也没有配套的复制/删除动作可测）。
 */
describe("FileService checks (single-account)", () => {
  let sessionStore: any;
  let service: FileService;

  beforeEach(() => {
    // 会话元信息权威来源：sessions/<id>/meta.json（SessionFileStore）
    sessionStore = {
      get: jest.fn().mockReturnValue(undefined),
    };

    service = new FileService(
      {} as any,
      {} as any,
      sessionStore,
      {} as any,
      { toResourceAbsoluteUrl: (url: string) => url } as any,
    );
  });

  it("rejects upload when the session does not exist", async () => {
    sessionStore.get.mockReturnValue(undefined);

    await expect(
      service.uploadFile("session-1", {
        originalname: "note.txt",
        size: 1,
        buffer: Buffer.from("a"),
      }),
    ).rejects.toThrow("Session not found");
  });
});
