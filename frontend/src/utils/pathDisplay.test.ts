import { describe, it, expect } from "vitest";
import { splitPathDisplay } from "./pathDisplay";

/**
 * 文件路径行内展示拆分（ZCode 同款三段式行头的数据层）：
 * 文件名（主识别信息）+ 父目录（保留尾斜杠、次要色、优先截断）。
 */
describe("splitPathDisplay", () => {
  it("POSIX 路径：文件名 + 带尾斜杠的目录", () => {
    const d = splitPathDisplay("server/jobs/handlers.ts");
    expect(d).toEqual({
      fileName: "handlers.ts",
      dirPath: "server/jobs/",
      fullPath: "server/jobs/handlers.ts",
    });
  });

  it("Windows 反斜杠路径：统一按 / 处理", () => {
    const d = splitPathDisplay("D:\\AI\\ai_chat\\frontend\\src\\utils\\toolDisplay.ts");
    expect(d!.fileName).toBe("toolDisplay.ts");
    expect(d!.dirPath).toBe("D:/AI/ai_chat/frontend/src/utils/");
    expect(d!.fullPath).toBe("D:\\AI\\ai_chat\\frontend\\src\\utils\\toolDisplay.ts");
  });

  it("目录串保留尾斜杠，即使目录段含与文件名同名的子串", () => {
    // "a/handlers.ts/handlers.ts" 这种病态路径也不能截错位置
    const d = splitPathDisplay("a/handlers.ts/handlers.ts");
    expect(d!.fileName).toBe("handlers.ts");
    expect(d!.dirPath).toBe("a/handlers.ts/");
  });

  it("裸文件名：dirPath 为 null", () => {
    const d = splitPathDisplay("README.md");
    expect(d!.fileName).toBe("README.md");
    expect(d!.dirPath).toBeNull();
  });

  it("结尾分隔符被忽略：'a/b/' 与 'a/b' 拆分一致", () => {
    expect(splitPathDisplay("a/b/")!.fileName).toBe("b");
    expect(splitPathDisplay("a/b/")!.dirPath).toBe("a/");
  });

  it("无扩展名文件照常拆分", () => {
    const d = splitPathDisplay("usr/local/bin/make");
    expect(d!.fileName).toBe("make");
    expect(d!.dirPath).toBe("usr/local/bin/");
  });

  it("POSIX 绝对路径：保留前导斜杠（根不该被剥掉）", () => {
    const d = splitPathDisplay("/tmp/x/a.ts");
    expect(d!.fileName).toBe("a.ts");
    expect(d!.dirPath).toBe("/tmp/x/");
  });

  it("空串返回 null（调用方按 falsy 走纯文本分支）", () => {
    expect(splitPathDisplay("")).toBeNull();
    expect(splitPathDisplay("///")).toBeNull();
  });
});
