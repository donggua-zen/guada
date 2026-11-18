import { Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import {
  OcrService,
  cleanDeepSeekOcrText,
  parseDeepSeekOcrResponse,
} from "./ocr.service";
import type { SettingsService } from "../settings/settings.service";
import type { ProviderFileStore } from "../llm-core/provider-file.store";
import type { PdfToImageService } from "../../common/pdf-render/pdf-to-image.service";

const silentLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
} as unknown as Logger;

// ── 纯函数：标记清洗与响应解析 ────────────────────────────────

describe("cleanDeepSeekOcrText", () => {
  it("剥离 ref/box 标记与坐标，仅保留可读文字", () => {
    const raw =
      "<｜ref｜>标题<｜/ref｜><｜box｜>[[52, 40, 948, 96]]<｜/box｜>\n正文<｜box｜>[[1,2,3,4]]<｜/box｜>";
    expect(cleanDeepSeekOcrText(raw)).toBe("标题\n正文");
  });

  it("清除其它残留的 ｜xx｜ 标记", () => {
    expect(cleanDeepSeekOcrText("a<｜foo｜>b<｜/foo｜>c")).toBe("abc");
  });

  it("无标记的纯文本保持不变", () => {
    expect(cleanDeepSeekOcrText("  普通文本\n第二行  ")).toBe("  普通文本\n第二行  ");
  });
});

describe("parseDeepSeekOcrResponse", () => {
  it("解析带保活换行的 JSON，按页拼接并清洗", () => {
    const body =
      "\n\n" +
      JSON.stringify({
        page_count: 2,
        pages: [
          { index: 0, text: "<｜ref｜>第一章<｜/ref｜>", finish_reason: "stop" },
          { index: 1, text: "第二章正文", finish_reason: "stop" },
        ],
      });
    expect(parseDeepSeekOcrResponse(body, silentLogger, "doc.pdf")).toBe("第一章\n第二章正文");
  });

  it("接受已解析的对象", () => {
    const result = parseDeepSeekOcrResponse(
      { pages: [{ text: "hello" }] },
      silentLogger,
      "x",
    );
    expect(result).toBe("hello");
  });

  it("finish_reason=length 时 warn 但仍返回文本", () => {
    const result = parseDeepSeekOcrResponse(
      { pages: [{ text: "截断文本", finish_reason: "length" }] },
      silentLogger,
      "x",
    );
    expect(result).toBe("截断文本");
    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("1 页输出被截断"),
    );
  });

  it("HTTP 200 内的 error 对象抛出可读错误", () => {
    expect(() =>
      parseDeepSeekOcrResponse(
        JSON.stringify({ error: { message: "OCR did not finish in time" } }),
        silentLogger,
        "x",
      ),
    ).toThrow("OCR did not finish in time");
  });

  it("空 pages 抛错", () => {
    expect(() =>
      parseDeepSeekOcrResponse({ pages: [] }, silentLogger, "x"),
    ).toThrow("未返回识别结果");
  });

  it("非法 JSON 抛错", () => {
    expect(() => parseDeepSeekOcrResponse("not json", silentLogger, "x")).toThrow(
      "不是合法 JSON",
    );
  });
});

// ── 服务：能力声明、Key 复用、图片识别分派 ─────────────────────

function makeService(opts: {
  ocrSettings: Record<string, any>;
  providers?: any[];
  httpPost?: jest.Mock;
}) {
  const httpPost = (opts.httpPost ?? jest.fn()) as jest.Mock<unknown, any[]>;
  const httpService = { post: httpPost } as unknown as HttpService;
  const settingsService = {
    getGroupSettings: jest.fn(async () => opts.ocrSettings),
  } as unknown as SettingsService;
  const providerStore = {
    listProviders: jest.fn(() => opts.providers ?? []),
  } as unknown as ProviderFileStore;
  const pdfToImage = {} as PdfToImageService;

  const service = new OcrService(
    httpService,
    settingsService,
    pdfToImage,
    providerStore,
  );
  return { service, httpPost, providerStore };
}

const deepSeekSettings = {
  provider: "deepseek",
  deepseek: { apiKey: "", useProviderKey: true },
};

describe("OcrService (DeepSeek)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getCapabilities 声明 render 模式", async () => {
    const { service } = makeService({ ocrSettings: deepSeekSettings });
    expect(await service.getCapabilities()).toEqual({
      supportsPdf: true,
      supportsImage: true,
      pdfMode: "render",
    });
  });

  it("useProviderKey 时复用模型服务中 enabled 的 DeepSeek Key", async () => {
    const httpPost = jest.fn(() =>
      of({ data: JSON.stringify({ pages: [{ text: "ok" }] }) }),
    );
    const { service } = makeService({
      ocrSettings: deepSeekSettings,
      providers: [
        { type: "deepseek", apiKey: "sk-disabled", enabled: false },
        { type: "deepseek", apiKey: "sk-enabled", enabled: true },
        { type: "openai", apiKey: "sk-other", enabled: true },
      ],
      httpPost,
    });

    expect(await service.recognizeImageBuffer(Buffer.from("img"), "image/png", "a.png")).toBe("ok");
    const headers = (httpPost.mock.calls as any[])[0][2].headers;
    expect(headers.Authorization).toBe("Bearer sk-enabled");
  });

  it("模型服务无 DeepSeek Key 时报可行动作错误，且不发请求", async () => {
    const httpPost = jest.fn();
    const { service } = makeService({
      ocrSettings: deepSeekSettings,
      providers: [{ type: "openai", apiKey: "sk-other", enabled: true }],
      httpPost,
    });
    await expect(
      service.recognizeImageBuffer(Buffer.from("img"), "image/png", "a.png"),
    ).rejects.toThrow("请在「模型服务」中配置 DeepSeek 供应商");
    expect(httpPost).not.toHaveBeenCalled();
  });

  it("useProviderKey=false 时使用手动填写的 Key", async () => {
    const httpPost = jest.fn(() =>
      of({ data: JSON.stringify({ pages: [{ text: "ok" }] }) }),
    );
    const { service } = makeService({
      ocrSettings: {
        provider: "deepseek",
        deepseek: { apiKey: "sk-manual", useProviderKey: false },
      },
      providers: [{ type: "deepseek", apiKey: "sk-model", enabled: true }],
      httpPost,
    });
    await service.recognizeImageBuffer(Buffer.from("img"), "image/png", "a.png");
    expect((httpPost.mock.calls as any[])[0][2].headers.Authorization).toBe("Bearer sk-manual");
  });

  it("multipart 请求体含 purpose 与 file，未显式 useProviderKey 时默认复用模型 Key", async () => {
    const httpPost = jest.fn(() =>
      of({ data: { pages: [{ text: "t" }] } }),
    );
    const { service } = makeService({
      ocrSettings: { provider: "deepseek", deepseek: {} },
      providers: [{ type: "deepseek", apiKey: "sk-default", enabled: true }],
      httpPost,
    });
    await service.recognizeImageBuffer(Buffer.from("img"), "image/png", "a.png");
    expect((httpPost.mock.calls as any[])[0][2].headers.Authorization).toBe("Bearer sk-default");

    const form = (httpPost.mock.calls as any[])[0][1];
    // form-data 实例：purpose 在 file 之前 append，getBuffer 中包含字段名
    const body = (form as any).getBuffer().toString("utf8");
    expect(body.indexOf("name=\"purpose\"")).toBeLessThan(body.indexOf("name=\"file\""));
    expect(body).toContain("text_recognition");
  });

  it("识别结果为空时抛错", async () => {
    const httpPost = jest.fn(() =>
      of({ data: JSON.stringify({ pages: [] }) }),
    );
    const { service } = makeService({
      ocrSettings: deepSeekSettings,
      providers: [{ type: "deepseek", apiKey: "sk-1", enabled: true }],
      httpPost,
    });
    await expect(
      service.recognizeImageBuffer(Buffer.from("img"), "image/png", "a.png"),
    ).rejects.toThrow("未返回识别结果");
  });

  it("HTTP 错误由 axios 抛出时向上传播", async () => {
    const httpPost = jest.fn(() => throwError(() => new Error("402 insufficient balance")));
    const { service } = makeService({
      ocrSettings: deepSeekSettings,
      providers: [{ type: "deepseek", apiKey: "sk-1", enabled: true }],
      httpPost,
    });
    await expect(
      service.recognizeImageBuffer(Buffer.from("img"), "image/png", "a.png"),
    ).rejects.toThrow("402 insufficient balance");
  });
});

// ── 回归：既有供应商行为不变 ──────────────────────────────────

describe("OcrService (既有供应商回归)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("未配置时 recognizeImageBuffer 抛「OCR 未配置」", async () => {
    const { service } = makeService({ ocrSettings: { provider: "none" } });
    await expect(service.recognizeImageBuffer(Buffer.from("x"))).rejects.toThrow(
      "OCR 未配置",
    );
  });

  it("百度能力声明不变（render）", async () => {
    const { service } = makeService({ ocrSettings: { provider: "baidu" } });
    expect(await service.getCapabilities()).toEqual({
      supportsPdf: true,
      supportsImage: true,
      pdfMode: "render",
    });
  });

  it("UMI 能力声明不变（native）", async () => {
    const { service } = makeService({ ocrSettings: { provider: "umi" } });
    expect(await service.getCapabilities()).toEqual({
      supportsPdf: true,
      supportsImage: true,
      pdfMode: "native",
    });
  });

  it("两参构造（无 ProviderFileStore）在手动 Key 场景仍可用", async () => {
    const httpPost = jest.fn(() =>
      of({ data: { pages: [{ text: "ok" }] } }),
    );
    const service = new OcrService(
      { post: httpPost } as unknown as HttpService,
      { getGroupSettings: async () => ({
        provider: "deepseek",
        deepseek: { apiKey: "sk-only", useProviderKey: false },
      }) } as unknown as SettingsService,
    );
    expect(await service.recognizeImageBuffer(Buffer.from("x"))).toBe("ok");
  });
});
