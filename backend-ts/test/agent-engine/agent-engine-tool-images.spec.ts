/// <reference types="jest" />

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import sharp from "sharp";
import { AgentEngine } from "../../src/modules/chat/agent-engine.service";
import type { Message } from "../../src/common/types/conversation.types";
import type { ToolCallResponse } from "../../src/modules/tools/interfaces/tool-provider.interface";
import { getSessionDir } from "../../src/common/utils/session-path.util";
import { createMockSessionContext } from "./helpers/mock-factories";

/**
 * 工具产出图片的物化与内嵌（executeToolsAndBuildParts 图片分支）。
 *
 * 持久化契约：
 * - 快照/事件日志只存 FileRef 路径指针，不存 base64（jsonl-persistence-design §3.3）；
 * - 图片不拆分落库：物化结果内嵌在 tool-result.images，与 name/toolCallId 同块，
 *   归属可直接追溯；请求侧再派生为隐藏 user 消息（tool-image-expansion）。
 *
 * 本套件钉住：
 * - imageRefs（磁盘引用）→ 会话目录外转码落副本、会话目录内零复制转正；
 * - images（base64，MCP 等兜底）→ 解码物化；
 * - 物化失败降级 data: URL / 追加文本告知，回合不失败；
 * - 任何成功路径的 tool-result 都不出现 data: URL；
 * - 不再生成隐藏 user 消息。
 */

const SESSION_ID = "test-session-001";

describe("AgentEngine - tool image materialization", () => {
  let tmpRoot: string;

  /** 组装一次带单工具调用的 assistant 消息，驱动私有 executeToolsAndBuildParts */
  async function runWithResponse(
    response: Partial<ToolCallResponse>,
  ): Promise<{ toolParts: Message[]; toolEvent: any }> {
    const assistantMessage: Message = {
      id: "a1",
      role: "assistant",
      kind: "model",
      source: { kind: "model", provider: "p1", model: "test-model" },
      metadata: {},
      content: [
        {
          type: "tool-call",
          toolCallId: "call_1",
          name: "image_view",
          arguments: "{}",
        },
      ],
    };
    const toolExecutor = {
      executeBatch: jest.fn().mockResolvedValue([response]),
    };
    const engine = new AgentEngine(toolExecutor as any, {} as any, {} as any);
    const sessionContext = createMockSessionContext();
    const { toolParts, toolEvent } = await (
      engine as any
    ).executeToolsAndBuildParts(assistantMessage, "turn-1", sessionContext);
    return { toolParts: toolParts as Message[], toolEvent };
  }

  /** 取工具结果消息（图片直接内嵌在这里，不再有隐藏 user 消息） */
  function toolResultMessage(toolParts: Message[]): Message {
    const msg = toolParts.find((m) => m.role === "tool");
    expect(msg).toBeDefined();
    return msg!;
  }

  /** 取 tool-result 块（含 images） */
  function toolResultBlock(toolParts: Message[]): any {
    const block = toolResultMessage(toolParts).content.find(
      (b: any) => b.type === "tool-result",
    );
    expect(block).toBeDefined();
    return block;
  }

  /** 取 tool-result.images */
  function toolImages(toolParts: Message[]): any[] {
    return toolResultBlock(toolParts).images ?? [];
  }

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-images-"));
    process.env.SESSION_DATA_DIR = tmpRoot;
  });

  afterAll(() => {
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    // 每个用例独立会话目录：物化落盘互不可见（"零复制"断言不受先前用例影响）
    fs.rmSync(getSessionDir(SESSION_ID), { recursive: true, force: true });
  });

  it("imageRefs（会话目录外）→ 转码落副本，session 引用，tool-result 无 data:", async () => {
    const outsideDir = path.join(tmpRoot, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    const imagePath = path.join(outsideDir, "shot.png");
    const png = await sharp({
      create: {
        width: 80,
        height: 60,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(imagePath, png);

    const { toolParts } = await runWithResponse({
      content: "Image loaded successfully.",
      imageRefs: [
        {
          url: imagePath,
          refType: "local",
          media_type: "image/png",
          name: "shot.png",
        },
      ],
    });

    const images = toolImages(toolParts);
    expect(images).toHaveLength(1);
    const image = images[0];
    expect(image.refType).toBe("session");
    expect(image.mediaType).toBe("image/jpeg");
    expect(image.bytes).toBeGreaterThan(0);
    expect(image.url).toMatch(
      /^sessions\/test-session-001\/images\/\d{8}\//,
    );
    expect(image.previewUrl).toMatch(/^sessions\//);

    // 物理文件确实落盘（原图 + 缩略图），且 tool-result 整体不含 data: URL
    const physical = path.join(
      getSessionDir(SESSION_ID),
      "images",
      image.url.replace(/^sessions\/[^/]+\/images\//, ""),
    );
    expect(fs.existsSync(physical)).toBe(true);
    expect(fs.statSync(physical).size).toBe(image.bytes);
    const previewPhysical = path.join(
      getSessionDir(SESSION_ID),
      "previews",
      image.previewUrl!.replace(/^sessions\/[^/]+\/previews\//, ""),
    );
    expect(fs.existsSync(previewPhysical)).toBe(true);
    expect(JSON.stringify(toolParts)).not.toMatch(/data:image/);
  });

  it("imageRefs（会话目录内）→ 转正为自包含引用，零复制", async () => {
    // 会话目录内的既有图片（模拟用户上传图）
    const manualDir = path.join(getSessionDir(SESSION_ID), "images", "manual");
    fs.mkdirSync(manualDir, { recursive: true });
    const insidePath = path.join(manualDir, "uploaded.jpg");
    const jpg = await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: { r: 10, g: 200, b: 30 },
      },
    })
      .jpeg()
      .toBuffer();
    fs.writeFileSync(insidePath, jpg);

    const { toolParts } = await runWithResponse({
      content: "ok",
      imageRefs: [
        { url: insidePath, refType: "local", media_type: "image/jpeg" },
      ],
    });

    const image = toolImages(toolParts)[0];
    expect(image.url).toBe(
      "sessions/test-session-001/images/manual/uploaded.jpg",
    );
    expect(image.refType).toBe("session");
    expect(image.bytes).toBe(fs.statSync(insidePath).size);
    // 零复制：images/ 下没有新生成的日期目录副本
    const entries = fs
      .readdirSync(path.join(getSessionDir(SESSION_ID), "images"))
      .filter((n) => /^\d{8}$/.test(n));
    expect(entries).toEqual([]);
  });

  it("imageRefs（会话内 150KB~384KB 的上传尺寸图）→ 仍零复制转正（门槛取两预算较大者）", async () => {
    // 构造一张体积落在工具预算(150KB)与上传预算(384KB)之间的合法 JPEG：
    // 从高质量向下找第一个 ≤384KB 的编码（质量阶梯步进小，首个达标者贴近 384KB）
    let jpg: Buffer | null = null;
    for (const quality of [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40]) {
      const candidate = await sharp({
        create: {
          width: 900,
          height: 900,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
          noise: { type: "gaussian", mean: 128, sigma: 30 },
        },
      })
        .jpeg({ quality })
        .toBuffer();
      if (candidate.byteLength <= 384 * 1024) {
        jpg = candidate;
        break;
      }
    }
    expect(jpg).not.toBeNull();
    expect(jpg!.byteLength).toBeGreaterThan(150 * 1024);

    const bandDir = path.join(getSessionDir(SESSION_ID), "images", "band");
    fs.mkdirSync(bandDir, { recursive: true });
    const insidePath = path.join(bandDir, "uploaded.jpg");
    fs.writeFileSync(insidePath, jpg!);

    const { toolParts } = await runWithResponse({
      content: "ok",
      imageRefs: [
        { url: insidePath, refType: "local", media_type: "image/jpeg" },
      ],
    });

    const image = toolImages(toolParts)[0];
    // 转正为原引用（未被压缩到 150KB 工具预算）
    expect(image.url).toBe(
      "sessions/test-session-001/images/band/uploaded.jpg",
    );
    expect(image.bytes).toBe(jpg!.byteLength);
  });

  it("imageRefs（会话目录内但超体积）→ 不转正，缩放落副本", async () => {
    // 高斯噪声 JPEG 压缩率极差，稳定超过 100KB 预算
    const oversize = await sharp({
      create: {
        width: 1200,
        height: 1200,
        channels: 3,
        background: { r: 128, g: 128, b: 128 },
        noise: { type: "gaussian", mean: 128, sigma: 30 },
      },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect(oversize.byteLength).toBeGreaterThan(100 * 1024);
    const oversizeDir = path.join(getSessionDir(SESSION_ID), "images", "oversize");
    fs.mkdirSync(oversizeDir, { recursive: true });
    const insidePath = path.join(oversizeDir, "big.jpg");
    fs.writeFileSync(insidePath, oversize);

    const { toolParts } = await runWithResponse({
      content: "ok",
      imageRefs: [
        { url: insidePath, refType: "local", media_type: "image/jpeg" },
      ],
    });

    const image = toolImages(toolParts)[0];
    // 走了日期目录副本，而不是原样引用超体积文件
    expect(image.url).toMatch(
      /^sessions\/test-session-001\/images\/\d{8}\//,
    );
    expect(image.url).not.toBe(
      "sessions/test-session-001/images/oversize/big.jpg",
    );
    const physical = path.join(
      getSessionDir(SESSION_ID),
      "images",
      image.url.replace(/^sessions\/[^/]+\/images\//, ""),
    );
    expect(fs.existsSync(physical)).toBe(true);
    // 工具图走独立预算（CHAT_TOOL_IMAGE_TARGET_KB 默认 150KB），不是上传预算 384KB
    expect(fs.statSync(physical).size).toBeLessThanOrEqual(150 * 1024);
    expect(fs.statSync(physical).size).toBeLessThan(oversize.byteLength);
  });

  it("images（base64，MCP 兜底形态）→ 解码物化，session 引用", async () => {
    const png = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .png()
      .toBuffer();

    const { toolParts } = await runWithResponse({
      content: "screenshot ready",
      images: [{ media_type: "image/png", data: png.toString("base64") }],
    });

    const image = toolImages(toolParts)[0];
    expect(image.refType).toBe("session");
    expect(image.url).toMatch(
      /^sessions\/test-session-001\/images\/\d{8}\/tool-image/,
    );
    const physical = path.join(
      getSessionDir(SESSION_ID),
      "images",
      image.url.replace(/^sessions\/[^/]+\/images\//, ""),
    );
    expect(fs.existsSync(physical)).toBe(true);
    expect(JSON.stringify(toolParts)).not.toMatch(/data:image/);
  });

  it("imageRefs 指向失效路径 → 跳过该图并以文本告知模型，回合不失败", async () => {
    const { toolParts } = await runWithResponse({
      content: "view this",
      imageRefs: [
        {
          url: path.join(tmpRoot, "does-not-exist.png"),
          refType: "local",
          media_type: "image/png",
        },
      ],
    });

    const block = toolResultBlock(toolParts);
    expect(block.content).toContain("[image unavailable:");
    expect(block.images).toBeUndefined();
    expect(JSON.stringify(toolParts)).not.toMatch(/data:image/);
  });

  it("images base64 损坏 → 降级 data: URL（legacy 形态），回合不失败", async () => {
    // 非法图片字节：transcode 失败，但 base64 在手 → data: URL 降级
    const garbage = Buffer.from("not-an-image-at-all").toString("base64");
    const { toolParts } = await runWithResponse({
      content: "here",
      images: [{ media_type: "image/png", data: garbage }],
    });

    const image = toolImages(toolParts)[0];
    expect(image.url).toMatch(/^data:image\/png;base64,/);
    expect(image.bytes).toBeGreaterThan(0);
  });

  it("图片内嵌 tool-result，不再生成隐藏 user 消息；SSE 条目同带图片", async () => {
    const png = await sharp({
      create: {
        width: 30,
        height: 30,
        channels: 3,
        background: { r: 255, g: 255, b: 0 },
      },
    })
      .png()
      .toBuffer();
    const { toolParts, toolEvent } = await runWithResponse({
      toolCallId: "call_1",
      name: "image_view",
      content: "loaded",
      images: [{ media_type: "image/png", data: png.toString("base64") }],
    });

    // 只有一条 tool 结果消息，没有隐藏 user 消息
    expect(toolParts).toHaveLength(1);
    expect(toolParts[0].role).toBe("tool");
    expect(toolParts.some((m) => m.role === "user")).toBe(false);

    const block = toolResultBlock(toolParts);
    expect(block.name).toBe("image_view");
    expect(block.toolCallId).toBe("call_1");
    expect(block.images).toHaveLength(1);
    expect(JSON.stringify(toolParts)).not.toMatch(/data:image/);

    // 实时 SSE 条目同样携带图片引用（前端工具结果区据此渲染）
    expect(toolEvent.toolCallsResponse[0].images).toHaveLength(1);
    expect(toolEvent.toolCallsResponse[0].images[0].refType).toBe("session");
  });
});
