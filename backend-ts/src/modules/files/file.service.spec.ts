import { FileService } from "./file.service";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { getImageTargetBytes } from "../../common/utils/image-transcode.util";

/**
 * 附件上传的落点与契约测试
 *
 * 附件只落盘、不写 DB：上传返回内联 FileRef，随消息事件写进 JSONL。
 * 落点二分（见 FileRef.refType）：
 * - 位图 → 会话数据目录 <sessionsBase>/<id>/images + previews（sharp 转码 + 缩略图），
 *   refType='session'，url 自包含（sessions/<id>/...）——随会话删除免费、不占全局目录
 * - 其余 → 会话工作目录下的附件子目录，refType='workspace'，url 为相对引用
 * 两者都不解析文件内容——模型拿到的是路径引用，需要内容时自行选工具。
 */
describe("FileService upload routing", () => {
  let tmpRoot: string;
  let uploadRoot: string;
  let workspaceDir: string;
  let sessionsBase: string;
  let sessionStore: any;
  let workspaceService: any;
  let fileNamingService: any;
  let service: FileService;

  const makeFile = (name: string, content = "x") => ({
    originalname: name,
    size: Buffer.byteLength(content),
    buffer: Buffer.from(content),
  });

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "files-spec-"));
    uploadRoot = path.join(tmpRoot, "file_stores");
    workspaceDir = path.join(tmpRoot, "workspaces", "WORK-1");
    sessionsBase = path.join(tmpRoot, "sessions");
    fs.mkdirSync(uploadRoot, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    process.env.UPLOAD_ROOT_DIR = uploadRoot;
    process.env.SESSION_DATA_DIR = tmpRoot; // → sessionsBase = <tmpRoot>/sessions

    // 会话元信息权威来源：sessions/<id>/meta.json（SessionMetaStore）
    sessionStore = {
      get: jest.fn().mockReturnValue({ id: "session-1", workspacePath: workspaceDir }),
    };

    // 真实实现（日期目录 + 清理），它本身就是被测契约的一部分（相对路径形态）
    const { FileNamingService } = require("../../common/services/file-naming.service");
    fileNamingService = new FileNamingService();

    workspaceService = {
      resolveSessionWorkspaceDir: jest.fn().mockResolvedValue(workspaceDir),
      resolveAttachmentDir: jest.fn().mockResolvedValue(path.join(workspaceDir, "uploads")),
      toWorkspaceRelativeRef: (absPath: string, ws: string) =>
        path.relative(ws, absPath).split(path.sep).join("/"),
      getAttachmentSubdir: jest.fn().mockResolvedValue("uploads"),
    };

    service = new FileService(
      fileNamingService,
      sessionStore,
      workspaceService,
    );
  });

  afterEach(() => {
    delete process.env.UPLOAD_ROOT_DIR;
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("rejects upload when the session does not exist", async () => {
    sessionStore.get.mockReturnValue(undefined);

    await expect(
      service.uploadFile("session-1", makeFile("note.txt", "a")),
    ).rejects.toThrow("Session not found");
  });

  it("accepts a file without an extension（没有白名单，路径引用不关心格式）", async () => {
    const ref = await service.uploadFile("session-1", makeFile("Makefile", "all:\n\techo hi"));

    expect(ref.refType).toBe("workspace");
    // 无扩展名 → 不写 fileExtension（前端按缺省处理），MIME 退到 octet-stream
    expect(ref.fileExtension).toBeUndefined();
    expect(ref.mediaType).toBe("application/octet-stream");
    expect(ref.name).toBe("Makefile");
    // 仍然真的落盘，且文件名里没有多余的点
    expect(ref.url).toMatch(/^uploads\/\d{8}\/Makefile_\d{4}_[0-9a-f]{6}$/);
    expect(fs.existsSync(path.join(workspaceDir, ref.url as string))).toBe(true);
  });

  it("accepts arbitrary formats as path references（zip/exe/媒体/未知扩展）", async () => {
    const names = ["a.zip", "b.exe", "c.mp3", "d.unknownext", "e.tar.gz"];
    const refs = await Promise.all(
      names.map((name) => service.uploadFile("session-1", makeFile(name, "bytes"))),
    );
    const notWorkspace = refs.filter((r) => r.refType !== "workspace");
    expect(notWorkspace).toEqual([]);
    // 每个都落了盘
    const missing = refs.filter(
      (r) => !fs.existsSync(path.join(workspaceDir, r.url as string)),
    );
    expect(missing).toEqual([]);
  });
  it("rejects an empty file", async () => {
    await expect(
      service.uploadFile("session-1", makeFile("empty.txt", "")),
    ).rejects.toThrow("文件大小为 0");
  });

  it("rejects a file above the size limit", async () => {
    process.env.CHAT_UPLOAD_MAX_MB = "1";
    try {
      const oversize = {
        originalname: "big.bin",
        size: 2 * 1024 * 1024,
        buffer: Buffer.alloc(16),
      };
      await expect(service.uploadFile("session-1", oversize)).rejects.toThrow(
        "文件大小超出限制",
      );
    } finally {
      delete process.env.CHAT_UPLOAD_MAX_MB;
    }
  });

  // ── 非图片：落工作目录，只给路径引用 ──

  it("stores a non-image file in the session workspace with a relative ref", async () => {
    const ref = await service.uploadFile(
      "session-1",
      makeFile("季度报告.pdf", "PDF-BYTES"),
    );

    expect(ref.refType).toBe("workspace");
    expect(ref.fileExtension).toBe("pdf");
    expect(ref.mediaType).toBe("application/pdf");
    // name 必须是完整文件名（含扩展名）——模型靠它判断格式
    expect(ref.name).toBe("季度报告.pdf");
    expect(ref.bytes).toBe(Buffer.byteLength("PDF-BYTES"));

    // url 是相对工作目录的引用：uploads/<日期>/<名>_<时分>_<hash>.pdf
    expect(ref.url).toMatch(/^uploads\/\d{8}\/.+\.pdf$/);
    // 没有缩略图（非图片不该有）
    expect(ref.previewUrl).toBeUndefined();

    // 真的落在工作目录下，且字节原样（不做解码、不解析文档）
    const absolute = path.join(workspaceDir, ref.url as string);
    expect(fs.existsSync(absolute)).toBe(true);
    expect(fs.readFileSync(absolute).toString()).toBe("PDF-BYTES");
    // 全局附件目录里不该出现它
    expect(fs.existsSync(path.join(uploadRoot, "files"))).toBe(false);
  });

  it("keeps binary formats opaque (no text decoding, no parse)", async () => {
    const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe]);
    const ref = await service.uploadFile("session-1", {
      originalname: "book.docx",
      size: binary.length,
      buffer: binary,
    });

    expect(ref.refType).toBe("workspace");
    expect(ref.fileExtension).toBe("docx");
    expect(ref.mediaType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    // 字节必须逐字节一致（旧实现会把整个 buffer 当 UTF-8 文本读一遍）
    const stored = fs.readFileSync(path.join(workspaceDir, ref.url as string));
    expect(stored.equals(binary)).toBe(true);
  });

  it("routes non-raster 'images' (svg) to the workspace as plain files", async () => {
    const ref = await service.uploadFile(
      "session-1",
      makeFile("icon.svg", "<svg/>"),
    );

    // svg 不是位图：sharp 转不了、视觉模型也不接受 → 走路径引用，不落全局图片目录
    expect(ref.refType).toBe("workspace");
    expect(ref.fileExtension).toBe("svg");
    expect(fs.existsSync(path.join(uploadRoot, "images"))).toBe(false);
  });

  // ── 图片：落会话数据目录，自包含引用，声明与字节一致 ──

  it("stores an image in the session data dir and reports jpg/jpeg (transcode is truthful)", async () => {
    // 用 sharp 生成一张真实可解码的 PNG（手写 base64 容易造出坏样本）
    const sharp = (await import("sharp")).default;
    const pngBytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();

    const ref = await service.uploadFile("session-1", {
      originalname: "photo.png",
      size: pngBytes.length,
      buffer: pngBytes,
    });

    expect(ref.refType).toBe("session");
    // 关键：文件名扩展名 / fileExtension / mediaType 必须一起说 JPEG，
    // 否则就是"声明 image/png、字节是 JPEG"的三方不一致
    expect(ref.fileExtension).toBe("jpg");
    expect(ref.mediaType).toBe("image/jpeg");
    expect(ref.name).toBe("photo.jpg");
    // url 自包含：内嵌 sessionId，且带 images/ 前缀
    expect(ref.url).toMatch(/^sessions\/session-1\/images\/\d{8}\/.+\.jpg$/);
    expect(ref.previewUrl).toMatch(/^sessions\/session-1\/previews\/\d{8}\/.+\.jpg$/);

    // 字节落在会话数据目录下（随会话删除免费），而不是全局上传目录或工作目录
    const sessionDir = path.join(sessionsBase, "session-1");
    const imageAbs = path.join(sessionDir, (ref.url as string).replace(/^sessions\/session-1\//, ""));
    expect(fs.existsSync(imageAbs)).toBe(true);
    expect(fs.existsSync(path.join(uploadRoot, "images"))).toBe(false);
    expect(fs.existsSync(path.join(workspaceDir, "images"))).toBe(false);

    // 缩略图确实生成了
    const previewAbs = path.join(
      sessionDir,
      (ref.previewUrl as string).replace(/^sessions\/session-1\//, ""),
    );
    expect(fs.existsSync(previewAbs)).toBe(true);
    // 落盘内容真的是 JPEG（FFD8 魔数）
    const head = fs.readFileSync(imageAbs).subarray(0, 2);
    expect(head[0]).toBe(0xff);
    expect(head[1]).toBe(0xd8);
  });

  it("downscales a large image to the target budget and reports the stored size", async () => {
    // 真随机噪声 = JPEG 最坏情况，必须靠阶梯才能压到目标体积
    const sharp = (await import("sharp")).default;
    const size = 900;
    const raw = crypto.randomBytes(size * size * 3);
    const pngBytes = await sharp(raw, {
      raw: { width: size, height: size, channels: 3 },
    })
      .png()
      .toBuffer();
    // 前置条件：源图确实远大于目标预算，否则这个用例没有意义
    expect(pngBytes.length).toBeGreaterThan(200 * 1024);

    const ref = await service.uploadFile("session-1", {
      originalname: "big.png",
      size: pngBytes.length,
      buffer: pngBytes,
    });

    const sessionDir = path.join(sessionsBase, "session-1");
    const imageAbs = path.join(
      sessionDir,
      (ref.url as string).replace(/^sessions\/session-1\//, ""),
    );
    const stored = fs.statSync(imageAbs).size;

    // 体积保证：落盘字节 ≤ 上传预算（默认 384KB，env CHAT_IMAGE_TARGET_KB 可配）
    expect(stored).toBeLessThanOrEqual(getImageTargetBytes());
    // bytes 报的是**转码后实际落盘**的字节数，不是上传的原始大小
    expect(ref.bytes).toBe(stored);
    expect(ref.bytes).toBeLessThan(pngBytes.length);
  }, 30_000);

  it("session image dirs die with the session dir (rm -rf 整目录，零钩子)", async () => {
    const sharp = (await import("sharp")).default;
    const pngBytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#00ff00" },
    })
      .png()
      .toBuffer();

    await service.uploadFile("session-1", {
      originalname: "a.png",
      size: pngBytes.length,
      buffer: pngBytes,
    });

    const sessionDir = path.join(sessionsBase, "session-1");
    expect(fs.existsSync(path.join(sessionDir, "images"))).toBe(true);

    // 模拟会话删除（与 JsonlBackend.deleteSession / SessionMetaStore.deleteSession 相同的整目录 rm）
    fs.rmSync(sessionDir, { recursive: true, force: true });
    expect(fs.existsSync(path.join(sessionsBase, "session-1"))).toBe(false);
  });

  // ── 文件名编码：只在真的乱码时才修 ──

  it("keeps an already-correct UTF-8 filename intact", async () => {
    const ref = await service.uploadFile(
      "session-1",
      makeFile("季度报告.pdf", "x"),
    );
    expect(ref.name).toBe("季度报告.pdf");
  });

  it("repairs a latin1-mojibake filename (busboy default)", async () => {
    // 模拟 busboy 按 latin1 解析 UTF-8 字节后的名字
    const mojibake = Buffer.from("季度报告.pdf", "utf-8").toString("latin1");
    const ref = await service.uploadFile("session-1", makeFile(mojibake, "x"));
    expect(ref.name).toBe("季度报告.pdf");
  });
});

describe("FileService browseLocalPath", () => {
  let tmpRoot: string;
  let service: FileService;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fs-browse-spec-"));
    service = new FileService({} as any, {} as any, {} as any);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("falls back to the user's home dir when path is empty", async () => {
    const result = await service.browseLocalPath("");
    expect(result.path).toBe(os.homedir());
    expect(result.exists).toBe(true);
    expect(Array.isArray(result.entries)).toBe(true);
  });

  it("resolves the path and normalizes it (含尾部斜杠与 .. 段)", async () => {
    const target = path.join(tmpRoot, "a", "b");
    fs.mkdirSync(target, { recursive: true });
    const result = await service.browseLocalPath(
      path.join(tmpRoot, "a", "..", "a", "b") + path.sep,
    );
    expect(result.path).toBe(target);
    expect(result.exists).toBe(true);
  });

  it("returns exists:false for a missing path instead of throwing", async () => {
    const result = await service.browseLocalPath(path.join(tmpRoot, "nope"));
    expect(result.exists).toBe(false);
    expect(result.entries).toEqual([]);
    // path 回传解析后的值，前端据此展示「目录不存在」并可手改
    expect(result.path).toBe(path.join(tmpRoot, "nope"));
  });

  it("lists directories first with names locale-sorted, files carry size", async () => {
    fs.mkdirSync(path.join(tmpRoot, "zdir"));
    fs.mkdirSync(path.join(tmpRoot, "adir"));
    fs.writeFileSync(path.join(tmpRoot, "mfile.txt"), "hello");

    const result = await service.browseLocalPath(tmpRoot);

    expect(result.exists).toBe(true);
    expect(result.entries.map((e) => e.name)).toEqual([
      "adir",
      "zdir",
      "mfile.txt",
    ]);
    const file = result.entries.find((e) => e.name === "mfile.txt")!;
    expect(file.isDirectory).toBe(false);
    expect(file.size).toBe(5);
  });

  // Windows 无开发者模式/管理员权限时 symlink 会 EPERM，探测一次决定是否跳过
  const canSymlink = (() => {
    try {
      const probe = path.join(tmpRoot, ".symlink-probe");
      fs.symlinkSync(probe, probe + ".link", "file");
      fs.rmSync(probe + ".link");
      return true;
    } catch {
      return false;
    }
  })();

  it("classifies symlinked directories as directories (Dirent 对 symlink 报 false)", async () => {
    if (!canSymlink) return;

    const realDir = path.join(tmpRoot, "real");
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, path.join(tmpRoot, "link-dir"), "dir");
    fs.writeFileSync(path.join(tmpRoot, "file.txt"), "x");
    fs.symlinkSync(
      path.join(tmpRoot, "file.txt"),
      path.join(tmpRoot, "link-file"),
      "file",
    );

    const result = await service.browseLocalPath(tmpRoot);

    const linkDir = result.entries.find((e) => e.name === "link-dir")!;
    expect(linkDir.isDirectory).toBe(true);
    const linkFile = result.entries.find((e) => e.name === "link-file")!;
    expect(linkFile.isDirectory).toBe(false);
    expect(linkFile.size).toBe(1);
  });

  it("treats a broken symlink as a non-directory entry without throwing", async () => {
    if (!canSymlink) return;

    fs.symlinkSync(
      path.join(tmpRoot, "gone"),
      path.join(tmpRoot, "broken"),
      "file",
    );

    const result = await service.browseLocalPath(tmpRoot);

    const broken = result.entries.find((e) => e.name === "broken")!;
    expect(broken.isDirectory).toBe(false);
  });
});
