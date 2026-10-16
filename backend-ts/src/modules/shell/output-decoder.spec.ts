/**
 * OutputDecoder 直测
 *
 * 命令输出改走「子进程直写文件 fd + 父进程按偏移增量解码」之后，清洗路径不再经过
 * SanitizerTransform。这里锁住同一套行为矩阵（与 stream-sanitizer.spec.ts 等价），
 * 避免两条路径的语义分叉——它是 read 侧解码唯一的测试锚点。
 */
import * as iconv from "iconv-lite";
import { OutputDecoder } from "./stream-sanitizer";

/** 构造 GBK(cp936) 字节 */
const gbk = (text: string): Buffer => iconv.encode(text, "gbk");
/** 构造 UTF-8 字节 */
const utf8 = (text: string): Buffer => Buffer.from(text, "utf8");

/** 平台相关：GBK 回退只在 Windows 生效（非 Windows 一律按 utf-8） */
const onWindows = process.platform === "win32" ? it : it.skip;

/** 依次喂入 chunks（可选 flush），返回全部输出 */
function decode(chunks: Buffer[], encoding?: string, flush = true): string {
  // 真实调用点可能传 undefined（未指定编码 → 自动判定），构造参数类型是 string
  const decoder = new OutputDecoder(encoding as string);
  let out = "";
  for (const chunk of chunks) out += decoder.feed(chunk);
  if (flush) out += decoder.flush();
  return out;
}

describe("OutputDecoder 编码判定", () => {
  it("显式 utf-8 + 合法 UTF-8 字节：原样输出", () => {
    expect(decode([utf8("hello 离散数学\n")], "utf-8")).toBe("hello 离散数学\n");
  });

  it("显式 gbk：GBK 字节按 GBK 解码（平台无关）", () => {
    expect(decode([gbk("名称 离散数学\n")], "gbk")).toBe("名称 离散数学\n");
  });

  onWindows(
    "显式 utf-8 但字节是 GBK：回退 GBK 解码（事故回归，不再出现 U+FFFD）",
    () => {
      const out = decode(
        [gbk("Name               MB\n离散数学_p05.mp4\n")],
        "utf-8",
      );
      expect(out).toBe("Name               MB\n离散数学_p05.mp4\n");
      expect(out).not.toContain("\uFFFD");
    },
  );

  onWindows("未指定编码 + GBK 字节：自动判定 GBK", () => {
    expect(decode([gbk("离散数学\n")], undefined)).toBe("离散数学\n");
  });

  onWindows(
    "判定为 GBK 后粘滞：后续'形态合法 UTF-8'的 GBK 字节仍按 GBK 解",
    () => {
      // C9 A2 是 GBK「散」，同时恰好是合法 UTF-8（ɢ）——不粘滞就会被解错
      const ambiguous = gbk("散");
      const out = decode(
        [gbk("离散数学\n"), Buffer.concat([ambiguous, utf8("\n")])],
        undefined,
      );
      expect(out).toBe("离散数学\n散\n");
    },
  );
});

describe("OutputDecoder 跨 chunk 边界", () => {
  it("UTF-8 多字节字符被切断：流式解码器补全，无 U+FFFD", () => {
    const word = utf8("离散");
    const out = decode(
      [word.subarray(0, 1), word.subarray(1, 3), word.subarray(3), utf8("\n")],
      "utf-8",
    );
    expect(out).toBe("离散\n");
    expect(out).not.toContain("\uFFFD");
  });

  it("GBK 多字节字符被切断：流式解码器补全，无 U+FFFD", () => {
    const word = gbk("离散数学");
    const out = decode(
      [word.subarray(0, 1), word.subarray(1, 3), word.subarray(3)],
      "gbk",
    );
    // 无换行结尾 → 由 flush 交出（顺带验证 flush 里的解码器残留）
    expect(out).toBe("离散数学");
    expect(out).not.toContain("\uFFFD");
  });

  it("增量喂入与一次性喂入结果一致（按文件偏移增量读取的前提）", () => {
    const chunks = [utf8("alpha\n"), utf8("beta\n")];
    expect(decode(chunks, "utf-8")).toBe(decode([Buffer.concat(chunks)], "utf-8"));
  });
});

describe("OutputDecoder 清洗行为", () => {
  it("ANSI 转义序列被擦除", () => {
    expect(decode([utf8("\x1b[31mred\x1b[0m\n")], "utf-8")).toBe("red\n");
  });

  it("仅 \\r 的进度条帧折叠为最后一帧", () => {
    expect(decode([utf8("prog 1\rprog 2\rprog 3\n")], "utf-8")).toBe("prog 3\n");
  });

  it("未结束行：不 flush 留在缓冲，flush 时交出", () => {
    expect(decode([utf8("no newline")], "utf-8", false)).toBe("");
    expect(decode([utf8("no newline")], "utf-8")).toBe("no newline");
  });

  it("flushPartialLine 交出未结束行后，后续 feed 继续正常追加", () => {
    const decoder = new OutputDecoder("utf-8");
    expect(decoder.feed(utf8("Continue? (y/n): "))).toBe("");
    expect(decoder.flushPartialLine()).toBe("Continue? (y/n): ");
    expect(decoder.feed(utf8("y\n"))).toBe("y\n");
    expect(decoder.flush()).toBe("");
  });
});
