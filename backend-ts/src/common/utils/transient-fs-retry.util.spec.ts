import {
  isTransientFsError,
  withTransientFsRetry,
} from "./transient-fs-retry.util";

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: mock fs error`), { code });
}

describe("transient-fs-retry", () => {
  it("EMFILE/ENFILE 识别为瞬态错误", () => {
    expect(isTransientFsError(fsError("EMFILE"))).toBe(true);
    expect(isTransientFsError(fsError("ENFILE"))).toBe(true);
    expect(isTransientFsError(fsError("EACCES"))).toBe(false);
    expect(isTransientFsError(new Error("boom"))).toBe(false);
  });

  it("EMFILE 两次后成功：按指数退避重试到第 3 次", async () => {
    let calls = 0;
    const result = await withTransientFsRetry(
      async () => {
        calls++;
        if (calls < 3) throw fsError("EMFILE");
        return "ok";
      },
      { baseDelayMs: 1 },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("非瞬态错误立即抛出，不重试", async () => {
    let calls = 0;
    await expect(
      withTransientFsRetry(
        async () => {
          calls++;
          throw fsError("EACCES");
        },
        { baseDelayMs: 1 },
      ),
    ).rejects.toMatchObject({ code: "EACCES" });
    expect(calls).toBe(1);
  });

  it("重试次数用尽后抛出最后一次错误", async () => {
    let calls = 0;
    await expect(
      withTransientFsRetry(
        async () => {
          calls++;
          throw fsError("EMFILE");
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toMatchObject({ code: "EMFILE" });
    expect(calls).toBe(3);
  });
});
