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
 * 工具产出图片的物化与注入（executeToolsAndBuildParts 图片分支）。
 *
 * 持久化契约：快照/事件日志只存 FileRef 路径指针，不存 base64
 * （jsonl-persistence-design §3.3）。本套件钉住：
 * - imageRefs（磁盘引用）→ 会话目录外转码落副本、会话目录内零复制转正；
 * - images（base64，MCP 等兜底）→ 解码物化；
 * - 物化失败降级 data: URL / 跳过 + 文本告知，回合不失败；
 * - 任何成功路径的注入块中都不出现 data: URL。
 */

const SESSION_ID = "test-session-001";

describe("AgentEngine - tool image materialization", () => {
  let tmpRoot: string;

  /** 组装一次带单工具调用的 assistant 消息，驱动私有 executeToolsAndBuildParts */
  async function runWithResponse(
    response: Partial<ToolCallResponse>,
  ): Promise<Message[]> {
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
    const { toolParts } = await (engine as any).executeToolsAndBuildParts(
      assistantMessage,
      "turn-1",
      sessionContext,
    );
    return toolParts as Message[];
  }

  /** 取注入的隐藏 user 消息（role=user + metadata.hidden） */
  function hiddenImageMessage(toolParts: Message[]): Message {
    const msg = toolParts.find(
      (m) => m.role === "user" && m.metadata?.hidden === true,
    );
    expect(msg).toBeDefined();
    return msg!;
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

  it("imageRefs（会话目录外）→ 转码落副本，session 引用，注入块无 data:", async () => {
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

    const toolParts = await runWithResponse({
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

    const msg = hiddenImageMessage(toolParts);
    const imageBlock: any = msg.content.find((b: any) => b.type === "image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock.attachment.refType).toBe("session");
    expect(imageBlock.attachment.mediaType).toBe("image/jpeg");
    expect(imageBlock.attachment.bytes).toBeGreaterThan(0);
    expect(imageBlock.attachment.url).toMatch(
      /^sessions\/test-session-001\/images\/\d{8}\//,
    );
    expect(imageBlock.attachment.previewUrl).toMatch(/^sessions\//);

    // 物理文件确实落盘（原图 + 缩略图），且注入块整体不含 data: URL
    const physical = path.join(
      getSessionDir(SESSION_ID),
      "images",
      imageBlock.attachment.url.replace(/^sessions\/[^/]+\/images\//, ""),
    );
    expect(fs.existsSync(physical)).toBe(true);
    expect(fs.statSync(physical).size).toBe(imageBlock.attachment.bytes);
    const previewPhysical = path.join(
      getSessionDir(SESSION_ID),
      "previews",
      imageBlock.attachment.previewUrl!.replace(/^sessions\/[^/]+\/previews\//, ""),
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

    const toolParts = await runWithResponse({
      content: "ok",
      imageRefs: [
        { url: insidePath, refType: "local", media_type: "image/jpeg" },
      ],
    });

    const msg = hiddenImageMessage(toolParts);
    const imageBlock: any = msg.content.find((b: any) => b.type === "image");
    expect(imageBlock.attachment.url).toBe(
      "sessions/test-session-001/images/manual/uploaded.jpg",
    );
    expect(imageBlock.attachment.refType).toBe("session");
    expect(imageBlock.attachment.bytes).toBe(fs.statSync(insidePath).size);
    // 零复制：images/ 下没有新生成的日期目录副本
    const entries = fs
      .readdirSync(path.join(getSessionDir(SESSION_ID), "images"))
      .filter((n) => /^\d{8}$/.test(n));
    expect(entries).toEqual([]);
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

    const toolParts = await runWithResponse({
      content: "ok",
      imageRefs: [
        { url: insidePath, refType: "local", media_type: "image/jpeg" },
      ],
    });

    const msg = hiddenImageMessage(toolParts);
    const imageBlock: any = msg.content.find((b: any) => b.type === "image");
    // 走了日期目录副本，而不是原样引用超体积文件
    expect(imageBlock.attachment.url).toMatch(
      /^sessions\/test-session-001\/images\/\d{8}\//,
    );
    expect(imageBlock.attachment.url).not.toBe(
      "sessions/test-session-001/images/oversize/big.jpg",
    );
    const physical = path.join(
      getSessionDir(SESSION_ID),
      "images",
      imageBlock.attachment.url.replace(/^sessions\/[^/]+\/images\//, ""),
    );
    expect(fs.existsSync(physical)).toBe(true);
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

    const toolParts = await runWithResponse({
      content: "screenshot ready",
      images: [{ media_type: "image/png", data: png.toString("base64") }],
    });

    const msg = hiddenImageMessage(toolParts);
    const imageBlock: any = msg.content.find((b: any) => b.type === "image");
    expect(imageBlock.attachment.refType).toBe("session");
    expect(imageBlock.attachment.url).toMatch(
      /^sessions\/test-session-001\/images\/\d{8}\/tool-image/,
    );
    const physical = path.join(
      getSessionDir(SESSION_ID),
      "images",
      imageBlock.attachment.url.replace(/^sessions\/[^/]+\/images\//, ""),
    );
    expect(fs.existsSync(physical)).toBe(true);
    expect(JSON.stringify(toolParts)).not.toMatch(/data:image/);
  });

  it("imageRefs 指向失效路径 → 跳过该图并以文本告知模型，回合不失败", async () => {
    const toolParts = await runWithResponse({
      content: "view this",
      imageRefs: [
        {
          url: path.join(tmpRoot, "does-not-exist.png"),
          refType: "local",
          media_type: "image/png",
        },
      ],
    });

    const msg = hiddenImageMessage(toolParts);
    const texts = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text);
    expect(texts.some((t: string) => t.includes("[image unavailable:"))).toBe(
      true,
    );
    expect(
      msg.content.some((b: any) => b.type === "image"),
    ).toBe(false);
    expect(JSON.stringify(toolParts)).not.toMatch(/data:image/);
  });

  it("images base64 损坏 → 降级 data: URL（legacy 形态），回合不失败", async () => {
    // 非法图片字节：transcode 失败，但 base64 在手 → data: URL 降级
    const garbage = Buffer.from("not-an-image-at-all").toString("base64");
    const toolParts = await runWithResponse({
      content: "here",
      images: [{ media_type: "image/png", data: garbage }],
    });

    const msg = hiddenImageMessage(toolParts);
    const imageBlock: any = msg.content.find((b: any) => b.type === "image");
    expect(imageBlock.attachment.url).toMatch(/^data:image\/png;base64,/);
    expect(imageBlock.attachment.bytes).toBeGreaterThan(0);
  });

  it("工具结果消息与图片注入消息并列，工具结果本身不含图片字节", async () => {
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
    const toolParts = await runWithResponse({
      toolCallId: "call_1",
      name: "image_view",
      content: "loaded",
      images: [{ media_type: "image/png", data: png.toString("base64") }],
    });

    const toolMsg = toolParts.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(JSON.stringify(toolMsg)).not.toMatch(/data:image/);
    expect(hiddenImageMessage(toolParts)).toBeDefined();
  });
});
