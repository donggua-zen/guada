import { sliceJobText } from "./job-output.util";

/// <reference types="jest" />

describe("sliceJobText", () => {
  it("默认返回尾部，并给出 offset/nextOffset/size", () => {
    const read = sliceJobText("a".repeat(2048), { maxBytes: 1024 });
    expect(read.text).toBe("a".repeat(1024));
    expect(read.offset).toBe(1024);
    expect(read.nextOffset).toBe(2048);
    expect(read.size).toBe(2048);
    expect(read.truncated).toBe(true);
  });

  it("offset 读取从指定字节开始", () => {
    const read = sliceJobText("a".repeat(2048), { offset: 1024, maxBytes: 1024 });
    expect(read.text).toBe("a".repeat(1024));
    expect(read.offset).toBe(1024);
    expect(read.nextOffset).toBe(2048);
  });

  it("offset 落在多字节字符中间时向后对齐，不产生替换符", () => {
    // "中文abc" = 3 + 3 + 3 bytes
    const read = sliceJobText("中文abc", { offset: 1, maxBytes: 1024 });
    expect(read.text).toBe("文abc");
    expect(read.offset).toBe(3);
    expect(read.nextOffset).toBe(9);
  });

  it("尾部切点落在多字节字符中间时向前回退", () => {
    // 400 个汉字 = 1200 bytes；maxBytes=1025 会切在第 341 个汉字中间
    const read = sliceJobText("中".repeat(400), { offset: 0, maxBytes: 1025 });
    expect(read.text).toBe("中".repeat(341));
    expect(read.offset).toBe(0);
    expect(read.nextOffset).toBe(1023);
    expect(read.size).toBe(1200);
    expect(read.truncated).toBe(true);
  });

  it("空文本返回空片段", () => {
    const read = sliceJobText("", {});
    expect(read).toMatchObject({
      text: "",
      offset: 0,
      nextOffset: 0,
      size: 0,
      truncated: false,
    });
  });
});
