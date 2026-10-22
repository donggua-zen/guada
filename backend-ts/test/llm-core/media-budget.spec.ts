/// <reference types="jest" />

import type {
  ContentBlock,
  FileRef,
  Message,
} from "../../src/common/types/conversation.types";
import {
  clearMediaBudgetPressure,
  DEFAULT_REQUEST_MEDIA_BUDGET_BYTES,
  getMediaBudgetBytesForSession,
  getRequestMediaBudgetBytes,
  MEDIA_BUDGET_PRESSURE_TTL_MS,
  MIN_REQUEST_MEDIA_BUDGET_BYTES,
  projectMessagesForMediaBudget,
  shrinkMediaBudgetForSession,
} from "../../src/modules/llm-core/media-budget";

/**
 * 请求级媒体预算契约：
 * - 只改本次请求视图，像素/路径信息丢失时保留可回看的路径占位；
 * - 预算内零改动（同一引用返回）；
 * - 超预算时最新真实用户消息的媒体受保护，其余从新到旧贪心保留；
 * - 会话级压力状态对半收缩、有下限、有 TTL。
 */

function userMessage(id: string, content: ContentBlock[]): Message {
  return {
    id,
    role: "user",
    kind: "user",
    source: { kind: "user" },
    metadata: {},
    content,
  };
}

function pluginMessage(id: string, content: ContentBlock[]): Message {
  return {
    id,
    role: "user",
    kind: "model",
    source: { kind: "plugin", plugin: "image" },
    metadata: { hidden: true },
    content,
  };
}

function imageRef(name: string, bytes = 150 * 1024): FileRef {
  return {
    mediaType: "image/jpeg",
    bytes,
    name,
    url: `sessions/s1/images/${name}`,
    refType: "session",
  };
}

function imageBlock(name: string, bytes?: number): ContentBlock {
  return { type: "image", attachment: imageRef(name, bytes) };
}

/** 150KB 落盘 → base64 字符数 */
function base64Bytes(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

describe("projectMessagesForMediaBudget", () => {
  it("没有图片：原样返回（零拷贝）", () => {
    const messages = [userMessage("u1", [{ type: "text", text: "hi" }])];
    const out = projectMessagesForMediaBudget(messages, { maxMediaBytes: 1 });
    expect(out.messages).toBe(messages);
    expect(out.totalMediaBytes).toBe(0);
    expect(out.omittedImageCount).toBe(0);
  });

  it("预算内：不裁剪（同一引用返回）", () => {
    const messages = [
      userMessage("u1", [{ type: "text", text: "看" }]),
      pluginMessage("p1", [imageBlock("a.jpg")]),
    ];
    const budget = base64Bytes(150 * 1024) * 2;
    const out = projectMessagesForMediaBudget(messages, {
      maxMediaBytes: budget,
    });
    expect(out.messages).toBe(messages);
    expect(out.omittedImageCount).toBe(0);
    expect(out.retainedImageCount).toBe(1);
    expect(out.projectedMediaBytes).toBe(base64Bytes(150 * 1024));
  });

  it("超预算：从新到旧保留，最旧的图替换为带路径的文本占位", () => {
    const messages = [
      pluginMessage("p1", [imageBlock("old.jpg")]),
      pluginMessage("p2", [imageBlock("new.jpg")]),
    ];
    const oneImageBudget = base64Bytes(150 * 1024);
    const out = projectMessagesForMediaBudget(messages, {
      maxMediaBytes: oneImageBudget,
    });

    expect(out.omittedImageCount).toBe(1);
    expect(out.retainedImageCount).toBe(1);
    // 最新的保留
    expect(out.messages[1].content[0]).toEqual({
      type: "image",
      attachment: imageRef("new.jpg"),
    });
    // 最旧的变占位，且保留可回看路径
    const placeholder = out.messages[0].content[0] as {
      type: string;
      text: string;
    };
    expect(placeholder.type).toBe("text");
    expect(placeholder.text).toContain("media budget");
    expect(placeholder.text).toContain("image_view");
    expect(placeholder.text).toContain("old.jpg");
    // 存储层不受影响：入参消息未被就地修改
    expect(messages[0].content[0]).toEqual({
      type: "image",
      attachment: imageRef("old.jpg"),
    });
  });

  it("最新真实用户消息的媒体受保护，即使它更旧", () => {
    const messages = [
      userMessage("u1", [imageBlock("user.jpg")]),
      pluginMessage("p1", [imageBlock("tool.jpg")]),
    ];
    const out = projectMessagesForMediaBudget(messages, {
      maxMediaBytes: base64Bytes(150 * 1024),
    });
    expect(out.messages[0].content[0]).toEqual({
      type: "image",
      attachment: imageRef("user.jpg"),
    });
    expect((out.messages[1].content[0] as { type: string }).type).toBe("text");
  });

  it("插件注入的隐藏 user 消息不算真实用户消息", () => {
    const messages = [
      userMessage("u1", [{ type: "text", text: "go" }]),
      pluginMessage("p1", [imageBlock("a.jpg")]),
      pluginMessage("p2", [imageBlock("b.jpg")]),
    ];
    const out = projectMessagesForMediaBudget(messages, {
      maxMediaBytes: base64Bytes(150 * 1024),
    });
    // 保留最新的那张（p2），p1 淘汰
    expect((out.messages[1].content[0] as { type: string }).type).toBe("text");
    expect(out.messages[2].content[0]).toEqual({
      type: "image",
      attachment: imageRef("b.jpg"),
    });
  });

  it("preserveLatestUserMedia=false：用户图也参与淘汰", () => {
    const messages = [
      userMessage("u1", [imageBlock("user.jpg")]),
      pluginMessage("p1", [imageBlock("tool.jpg")]),
    ];
    const out = projectMessagesForMediaBudget(messages, {
      maxMediaBytes: base64Bytes(150 * 1024),
      preserveLatestUserMedia: false,
    });
    expect((out.messages[0].content[0] as { type: string }).type).toBe("text");
    expect(out.messages[1].content[0]).toEqual({
      type: "image",
      attachment: imageRef("tool.jpg"),
    });
  });

  it("data: URL 按内联长度计量，超预算时被淘汰", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(2048)}`;
    const inline: ContentBlock = {
      type: "image",
      attachment: { mediaType: "image/png", bytes: 3, url: dataUrl },
    };
    const messages = [
      pluginMessage("p1", [inline]),
      pluginMessage("p2", [imageBlock("new.jpg")]),
    ];
    const out = projectMessagesForMediaBudget(messages, {
      maxMediaBytes: base64Bytes(150 * 1024),
    });
    expect((out.messages[0].content[0] as { type: string }).type).toBe("text");
    expect(out.totalMediaBytes).toBe(dataUrl.length + base64Bytes(150 * 1024));
  });

  it("无路径可解析：占位退化为不含路径的短文案", () => {
    const bare: ContentBlock = {
      type: "image",
      attachment: { mediaType: "image/png", bytes: 150 * 1024 },
    };
    const messages = [
      pluginMessage("p1", [bare]),
      pluginMessage("p2", [imageBlock("new.jpg")]),
    ];
    const out = projectMessagesForMediaBudget(messages, {
      maxMediaBytes: base64Bytes(150 * 1024),
    });
    const placeholder = out.messages[0].content[0] as {
      type: string;
      text: string;
    };
    expect(placeholder.type).toBe("text");
    expect(placeholder.text).toContain("media budget");
    expect(placeholder.text).not.toContain("Image file path");
  });

  it("多图消息只替换超预算的部分，其余块保持不变", () => {
    const messages = [
      pluginMessage("p1", [
        { type: "text", text: "before" },
        imageBlock("a.jpg"),
        imageBlock("b.jpg"),
      ]),
    ];
    // 只装得下一张
    const out = projectMessagesForMediaBudget(messages, {
      maxMediaBytes: base64Bytes(150 * 1024),
    });
    expect(out.messages[0]).not.toBe(messages[0]);
    expect(out.messages[0].content[0]).toEqual({
      type: "text",
      text: "before",
    });
    expect((out.messages[0].content[1] as { type: string }).type).toBe("text");
    expect(out.messages[0].content[2]).toEqual({
      type: "image",
      attachment: imageRef("b.jpg"),
    });
  });

  it("受保护媒体本身超出总预算：不裁剪（交给上游错误兜底）", () => {
    const messages = [
      userMessage("u1", [imageBlock("big.jpg", 2 * 1024 * 1024)]),
    ];
    const out = projectMessagesForMediaBudget(messages, { maxMediaBytes: 1024 });
    expect(out.messages[0].content[0]).toEqual({
      type: "image",
      attachment: imageRef("big.jpg", 2 * 1024 * 1024),
    });
    expect(out.omittedImageCount).toBe(0);
  });
});

describe("淘汰边界的缓存稳定性", () => {
  /** 相邻两次请求之间，内容被改写的既有消息数（0 = 前缀完全稳定，缓存可整段命中） */
  function changedMessages(prev: Message[], next: Message[]): number {
    let changed = 0;
    const n = Math.min(prev.length, next.length);
    for (let i = 0; i < n; i++) {
      const a = JSON.stringify(prev[i].content);
      const b = JSON.stringify(next[i].content);
      if (a !== b) changed += 1;
    }
    return changed;
  }

  /**
   * 模拟「每轮追加一张截图」的稳态：返回零改写请求占比与最少保留张数。
   */
  function simulate(overshoot: number) {
    const budget = 10 * base64Bytes(150 * 1024); // 约能装 10 张
    const all: Message[] = [];
    let prev: Message[] | null = null;
    const changed: number[] = [];
    const kept: number[] = [];
    for (let n = 0; n < 120; n++) {
      all.push(pluginMessage(`p${n}`, [imageBlock(`${n}.jpg`)]));
      const out = projectMessagesForMediaBudget(all, {
        maxMediaBytes: budget,
        evictionOvershoot: overshoot,
      });
      if (prev) changed.push(changedMessages(prev, out.messages));
      prev = out.messages;
      kept.push(out.retainedImageCount);
    }
    const stable = changed.filter((c) => c === 0).length;
    return { stable, total: changed.length, minKept: Math.min(...kept.slice(-60)) };
  }

  it("量化后大部分请求的前缀完全稳定（缓存可整段命中）", () => {
    const quantized = simulate(0.25);
    // 精确填充时，每次新增一张都会把最旧的一张挤成占位 → 几乎每次都在改写
    const exact = simulate(0);

    expect(quantized.stable).toBeGreaterThan(quantized.total * 0.5);
    expect(quantized.stable).toBeGreaterThan(exact.stable * 3);
  });

  it("缓存友好的代价很小：仍保留大部分容量", () => {
    const quantized = simulate(0.25);
    // 预算约 10 张，量化后最少仍保留 8 张（步长 = 保留容量 × 0.25）
    expect(quantized.minKept).toBeGreaterThanOrEqual(7);
  });
});

describe("媒体预算配置与压力状态", () => {
  const originalEnv = process.env.CHAT_REQUEST_MEDIA_BUDGET_MB;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CHAT_REQUEST_MEDIA_BUDGET_MB;
    else process.env.CHAT_REQUEST_MEDIA_BUDGET_MB = originalEnv;
    clearMediaBudgetPressure("s-test");
  });

  it("默认 16MiB", () => {
    delete process.env.CHAT_REQUEST_MEDIA_BUDGET_MB;
    expect(getRequestMediaBudgetBytes()).toBe(16 * 1024 * 1024);
    expect(DEFAULT_REQUEST_MEDIA_BUDGET_BYTES).toBe(16 * 1024 * 1024);
  });

  it("env 可覆盖并夹在 1..256MiB", () => {
    process.env.CHAT_REQUEST_MEDIA_BUDGET_MB = "8";
    expect(getRequestMediaBudgetBytes()).toBe(8 * 1024 * 1024);
    process.env.CHAT_REQUEST_MEDIA_BUDGET_MB = "0";
    expect(getRequestMediaBudgetBytes()).toBe(1 * 1024 * 1024);
    process.env.CHAT_REQUEST_MEDIA_BUDGET_MB = "9999";
    expect(getRequestMediaBudgetBytes()).toBe(256 * 1024 * 1024);
  });

  it("压力状态对半收缩并在 TTL 后失效", () => {
    const now = 1_000_000;
    expect(getMediaBudgetBytesForSession("s-test", now)).toBe(getRequestMediaBudgetBytes());

    const first = shrinkMediaBudgetForSession("s-test", now);
    expect(first).toBe(Math.floor(getRequestMediaBudgetBytes() / 2));
    expect(getMediaBudgetBytesForSession("s-test", now)).toBe(first);

    const second = shrinkMediaBudgetForSession("s-test", now);
    expect(second).toBe(Math.floor(first! / 2));

    // TTL 过期后回落到默认值
    expect(
      getMediaBudgetBytesForSession("s-test", now + MEDIA_BUDGET_PRESSURE_TTL_MS + 1),
    ).toBe(getRequestMediaBudgetBytes());
  });

  it("收缩到下限返回 null，调用方保留原始错误", () => {
    const now = 1_000_000;
    let result: number | null = getRequestMediaBudgetBytes();
    let guard = 0;
    while (result !== null && guard++ < 10) {
      result = shrinkMediaBudgetForSession("s-test", now);
    }
    expect(result).toBeNull();
    expect(getMediaBudgetBytesForSession("s-test", now)).toBeGreaterThanOrEqual(
      MIN_REQUEST_MEDIA_BUDGET_BYTES,
    );
  });

  it("clearMediaBudgetPressure 立即恢复默认预算", () => {
    shrinkMediaBudgetForSession("s-test");
    clearMediaBudgetPressure("s-test");
    expect(getMediaBudgetBytesForSession("s-test")).toBe(getRequestMediaBudgetBytes());
  });
});
