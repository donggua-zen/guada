/// <reference types="jest" />

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileNamingService } from "../../src/common/services/file-naming.service";
import { SessionImageStore } from "../../src/common/services/session-image.store";

/** 1x1 红点 PNG（够 sharp 解码即可） */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("SessionImageStore", () => {
  const sessionId = "s-image-store-test";
  let baseDir: string;
  let store: SessionImageStore;

  beforeAll(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-image-store-"));
    process.env.SESSION_DATA_DIR = baseDir;
    store = new SessionImageStore(new FileNamingService());
  });

  afterAll(() => {
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("转码为 JPEG 并只落一份会话副本 + 一张缩略图", async () => {
    const { ref, absolutePath } = await store.save(sessionId, TINY_PNG, {
      baseName: "shot.png",
    });

    // 引用自包含、可随会话删除
    expect(ref.refType).toBe("session");
    expect(ref.mediaType).toBe("image/jpeg");
    expect(ref.fileExtension).toBe("jpg");
    expect(ref.url).toMatch(
      new RegExp(`^sessions/${sessionId}/images/\\d{8}/shot_\\d{4}_[0-9a-f]+\\.jpg$`),
    );
    expect(ref.previewUrl).toMatch(
      new RegExp(`^sessions/${sessionId}/previews/\\d{8}/shot_\\d{4}_[0-9a-f]+\\.jpg$`),
    );

    // 原图副本存在，且字节数与 FileRef 一致
    expect(fs.existsSync(absolutePath)).toBe(true);
    const stat = fs.statSync(absolutePath);
    expect(ref.bytes).toBe(stat.size);
    expect(stat.size).toBeLessThanOrEqual(150 * 1024);

    // 缩略图存在
    const previewRel = ref.previewUrl!.replace(`sessions/${sessionId}/`, "");
    const previewPath = path.join(baseDir, "sessions", sessionId, previewRel);
    expect(fs.existsSync(previewPath)).toBe(true);
  });

  it("同名 baseName 连续落盘不会互相覆盖", async () => {
    const a = await store.save(sessionId, TINY_PNG, { baseName: "same.png" });
    const b = await store.save(sessionId, TINY_PNG, { baseName: "same.png" });
    expect(a.ref.url).not.toBe(b.ref.url);
    expect(fs.existsSync(a.absolutePath)).toBe(true);
    expect(fs.existsSync(b.absolutePath)).toBe(true);
  });
});
