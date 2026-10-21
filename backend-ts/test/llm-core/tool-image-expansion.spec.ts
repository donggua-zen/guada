/// <reference types="jest" />

import * as os from "os";
import * as path from "path";
import type {
  FileRef,
  Message,
} from "../../src/common/types/conversation.types";
import { expandToolResultImages } from "../../src/modules/llm-core/tool-image-expansion";

/**
 * 工具图片 wire 派生契约：
 * - 存储层不拆消息，图片挂在 tool-result.images；
 * - 请求组装边界为多模态模型派生一条隐藏 user 消息；
 * - 连续工具结果保持连续，派生消息统一插在整组之后；
 * - 非多模态模型不派生（由 L1 image-projection 投影为文本）。
 */

const ctx = { supportsImageInput: true, workspaceDir: null };

function textMessage(id: string, text: string): Message {
  return {
    id,
    role: "user",
    kind: "user",
    source: { kind: "user" },
    metadata: {},
    content: [{ type: "text", text }],
  };
}

function assistantMessage(id: string): Message {
  return {
    id,
    role: "assistant",
    kind: "model",
    source: { kind: "model", provider: "p", model: "m" },
    metadata: {},
    content: [{ type: "text", text: "done" }],
  };
}

function toolMessage(
  id: string,
  toolCallId: string,
  name: string,
  images?: FileRef[],
): Message {
  return {
    id,
    role: "tool",
    kind: "model",
    source: { kind: "tool", toolCallId },
    metadata: {},
    content: [
      {
        type: "tool-result",
        toolCallId,
        name,
        content: "ok",
        ...(images ? { images } : {}),
      },
    ],
  };
}

function imageRef(name: string): FileRef {
  return {
    mediaType: "image/png",
    bytes: 128,
    name,
    url: path.join(os.tmpdir(), name),
    refType: "local",
  };
}

describe("expandToolResultImages", () => {
  it("单工具单图：整组之后插入一条隐藏 user 消息（标签 + image + 只读路径注解）", () => {
    const ref = imageRef("shot.png");
    const tool = toolMessage("t1", "call_1", "image_view", [ref]);
    const messages = [
      textMessage("u1", "看图"),
      assistantMessage("a1"),
      tool,
      assistantMessage("a2"),
    ];

    const out = expandToolResultImages(messages, ctx);

    expect(out).toHaveLength(messages.length + 1);
    expect(out[0]).toBe(messages[0]);
    expect(out[1]).toBe(messages[1]);
    expect(out[2]).toBe(tool);
    // 派生消息紧跟整组工具结果，位于后续 assistant 之前
    const derived = out[3];
    expect(derived.role).toBe("user");
    expect(derived.kind).toBe("model");
    expect(derived.source).toEqual({ kind: "plugin", plugin: "image" });
    expect(derived.metadata.hidden).toBe(true);
    expect(derived.metadata.derivedFromToolResults).toEqual([
      { toolCallId: "call_1", name: "image_view" },
    ]);
    expect(derived.id).toBe("t1:tool-images");

    expect(derived.content).toHaveLength(3);
    expect(derived.content[0]).toEqual({
      type: "text",
      text: "[Image returned by image_view]",
    });
    expect(derived.content[1]).toEqual({ type: "image", attachment: ref });
    const note = derived.content[2] as { type: string; text: string };
    expect(note.type).toBe("text");
    expect(note.text).toContain(path.normalize(ref.url!));
    expect(out[4]).toBe(messages[3]);
  });

  it("并行工具结果保持连续：派生消息插在整组之后，而不是插在工具结果中间", () => {
    const ref = imageRef("a.png");
    const messages = [
      textMessage("u1", "go"),
      assistantMessage("a1"),
      toolMessage("t1", "call_1", "image_view", [ref]),
      toolMessage("t2", "call_2", "web_search"),
      assistantMessage("a2"),
    ];

    const out = expandToolResultImages(messages, ctx);

    expect(out).toHaveLength(6);
    expect(out[2].id).toBe("t1");
    expect(out[3].id).toBe("t2");
    expect(out[4].id).toBe("t2:tool-images");
    expect(out[5].id).toBe("a2");
    // 无图工具不产生标签
    const texts = out[4].content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .filter((text: string) => text.startsWith("[Image returned by"));
    expect(texts).toEqual(["[Image returned by image_view]"]);
  });

  it("多个带图工具合并为一条派生消息，标签按工具顺序排列", () => {
    const a = imageRef("a.png");
    const b = imageRef("b.png");
    const messages = [
      assistantMessage("a1"),
      toolMessage("t1", "call_1", "image_view", [a]),
      toolMessage("t2", "call_2", "browser_run", [b]),
    ];

    const out = expandToolResultImages(messages, ctx);
    expect(out).toHaveLength(4);
    const derived = out[3];
    expect(derived.metadata.derivedFromToolResults).toEqual([
      { toolCallId: "call_1", name: "image_view" },
      { toolCallId: "call_2", name: "browser_run" },
    ]);
    const labels = derived.content
      .filter((block) => block.type === "text")
      .map((block: any) => block.text)
      .filter((text: string) => text.startsWith("[Image returned by"));
    expect(labels).toEqual([
      "[Image returned by image_view]",
      "[Image returned by browser_run]",
    ]);
    const imageBlocks = derived.content.filter((block) => block.type === "image");
    expect(imageBlocks).toHaveLength(2);
  });

  it("非多模态模型：不派生（原样返回，由 L1 管线投影）", () => {
    const messages = [
      toolMessage("t1", "call_1", "image_view", [imageRef("a.png")]),
    ];
    expect(
      expandToolResultImages(messages, {
        ...ctx,
        supportsImageInput: false,
      }),
    ).toBe(messages);
  });

  it("没有图片：原样返回（零拷贝）", () => {
    const messages = [
      assistantMessage("a1"),
      toolMessage("t1", "call_1", "web_search"),
    ];
    expect(expandToolResultImages(messages, ctx)).toBe(messages);
  });

  it("data: 内联图无物理路径：不追加路径注解", () => {
    const ref: FileRef = {
      mediaType: "image/png",
      bytes: 3,
      url: "data:image/png;base64,QUJD",
      refType: "local",
    };
    const messages = [toolMessage("t1", "call_1", "image_view", [ref])];

    const out = expandToolResultImages(messages, ctx);
    const derived = out[1];
    expect(derived.content).toHaveLength(2);
    expect(derived.content[0]).toEqual({
      type: "text",
      text: "[Image returned by image_view]",
    });
    expect(derived.content[1]).toEqual({ type: "image", attachment: ref });
  });
});
