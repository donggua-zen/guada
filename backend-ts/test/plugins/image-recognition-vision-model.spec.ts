/**
 * 图像识别（独立视觉模型路径）流式词表回归
 *
 * 回归：曾按旧词表读 `type: "text" / content`，与适配器输出的 text_delta 不匹配，
 * 视觉模型明明返回了描述却被丢弃 → 恒回退 "Unable to recognize image content"。
 */
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { ImageRecognitionPlugin } from "../../src/modules/plugins/builtins/image-recognition.plugin";

/// <reference types="jest" />

/** 1x1 透明 PNG（sharp 可解析的最小合法图） */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const VISUAL_MODEL = {
  id: "inst-v:vision-1",
  modelName: "vision-1",
  provider: { id: "inst-v", type: "custom", protocol: "openai" },
};

function buildPlugin(chunks: any[]) {
  const llmService = {
    completions: jest.fn(async () =>
      (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
    ),
  };
  const providerStore = { findModel: jest.fn(() => VISUAL_MODEL) };
  const settingsStorage = {
    getSettingValue: jest.fn(async () => VISUAL_MODEL.id),
  };
  const plugin = new ImageRecognitionPlugin(
    llmService as any,
    providerStore as any,
    settingsStorage as any,
    {} as any,
  );
  return { plugin, llmService };
}

describe("图像识别（视觉模型路径）", () => {
  let imagePath: string;

  beforeAll(async () => {
    imagePath = path.join(os.tmpdir(), `vision-regression-${Date.now()}.png`);
    await fs.writeFile(imagePath, PNG_1PX);
  });

  afterAll(async () => {
    await fs.rm(imagePath, { force: true });
  });

  it("text_delta 增量累积为识别结果", async () => {
    const { plugin } = buildPlugin([
      { type: "block_start", index: 0, blockType: "text" },
      { type: "text_delta", index: 0, text: "一只" },
      { type: "text_delta", index: 0, text: "猫" },
      { type: "block_end", index: 0, block: { type: "text", text: "一只猫" } },
      { type: "finish", finishReason: "stop" },
    ]);

    const result = await (plugin as any).recognizeImageViaVisionModel(imagePath);

    expect(result).toBe("一只猫");
  });

  it("仅思考内容（无 text_delta）→ 回退提示语", async () => {
    const { plugin } = buildPlugin([
      { type: "reasoning_delta", index: 0, text: "分析中……" },
      { type: "finish", finishReason: "stop" },
    ]);

    const result = await (plugin as any).recognizeImageViaVisionModel(imagePath);

    expect(result).toBe("Unable to recognize image content");
  });
});
