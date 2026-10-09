/**
 * SanitizerTransform 解码测试
 *
 * 固化 2026-10-08 事故后的两条约束：
 * 1. Windows 上声明 utf-8 也不能盲信：chunk 不是合法 UTF-8 时按 GBK 解码
 *    （zh-CN Windows 的 powershell/python 往管道写 cp936，实测把 `离散数学` 解成 `��ɢ��ѧ`）。
 * 2. 跨 chunk 被切断的多字节字符必须由流式解码器补全，不得产生 U+FFFD。
 */
import * as iconv from "iconv-lite";
import { SanitizerTransform } from "./stream-sanitizer";

/** 构造 GBK(cp936) 字节 */
const gbk = (text: string): Buffer => iconv.encode(text, "gbk");
/** 构造 UTF-8 字节 */
const utf8 = (text: string): Buffer => Buffer.from(text, "utf8");

/** 平台相关：GBK 回退只在 Windows 生效（非 Windows 一律按 utf-8） */
const onWindows = process.platform === "win32" ? it : it.skip;

/** 把 chunks 依次写入 Transform，返回全部输出（字符串） */
function decode(chunks: Buffer[], encoding?: string): Promise<string> {
  // 真实调用点可能传 undefined（未指定编码 → 自动判定），构造参数类型是 string
  const transform = new SanitizerTransform(encoding as string);
  return new Promise((resolve, reject) => {
    let out = "";
    transform.on("data", (chunk: Buffer | string) => {
      out += chunk.toString();
    });
    transform.on("end", () => resolve(out));
    transform.on("error", reject);
    for (const chunk of chunks) transform.write(chunk);
    transform.end();
  });
}

describe("SanitizerTransform 编码判定", () => {
  it("显式 utf-8 + 合法 UTF-8 字节：原样输出", async () => {
    const out = await decode([utf8("hello 离散数学\n")], "utf-8");
    expect(out).toBe("hello 离散数学\n");
  });

  it("显式 gbk：GBK 字节按 GBK 解码（平台无关）", async () => {
    const out = await decode([gbk("名称 离散数学\n")], "gbk");
    expect(out).toBe("名称 离散数学\n");
  });

  onWindows(
    "显式 utf-8 但字节是 GBK：回退 GBK 解码（事故回归，不再出现 U+FFFD）",
    async () => {
      const out = await decode(
        [gbk("Name               MB\n离散数学_p05.mp4\n")],
        "utf-8",
      );
      expect(out).toBe("Name               MB\n离散数学_p05.mp4\n");
      expect(out).not.toContain("\uFFFD");
    },
  );

  onWindows("未指定编码 + GBK 字节：自动判定 GBK", async () => {
    const out = await decode([gbk("离散数学\n")], undefined);
    expect(out).toBe("离散数学\n");
  });

  onWindows(
    "判定为 GBK 后粘滞：后续'形态合法 UTF-8'的 GBK 字节仍按 GBK 解",
    async () => {
      // C9 A2 是 GBK「散」，同时恰好是合法 UTF-8（ɢ）——不粘滞就会被解错
      const ambiguous = gbk("散");
      const out = await decode(
        [gbk("离散数学\n"), Buffer.concat([ambiguous, utf8("\n")])],
        undefined,
      );
      expect(out).toBe("离散数学\n散\n");
    },
  );
});

describe("SanitizerTransform 跨 chunk 边界", () => {
  it("UTF-8 多字节字符被切断：流式解码器补全，无 U+FFFD", async () => {
    const word = utf8("离散");
    const out = await decode(
      [word.subarray(0, 1), word.subarray(1, 3), word.subarray(3), utf8("\n")],
      "utf-8",
    );
    expect(out).toBe("离散\n");
    expect(out).not.toContain("\uFFFD");
  });

  it("GBK 多字节字符被切断：流式解码器补全，无 U+FFFD", async () => {
    const word = gbk("离散数学");
    const out = await decode(
      [word.subarray(0, 1), word.subarray(1, 3), word.subarray(3)],
      "gbk",
    );
    // 无换行结尾 → 由 _flush 交出（顺带验证 _flush 里的解码器残留）
    expect(out).toBe("离散数学");
    expect(out).not.toContain("\uFFFD");
  });
});

describe("SanitizerTransform 清洗行为回归", () => {
  it("ANSI 转义序列被擦除", async () => {
    const out = await decode([utf8("\x1b[31mred\x1b[0m\n")], "utf-8");
    expect(out).toBe("red\n");
  });

  it("仅 \\r 的进度条帧折叠为最后一帧", async () => {
    const out = await decode([utf8("prog 1\rprog 2\rprog 3\n")], "utf-8");
    expect(out).toBe("prog 3\n");
  });

  it("不完整的行由 _flush 交出", async () => {
    const out = await decode([utf8("no newline")], "utf-8");
    expect(out).toBe("no newline");
  });
});
