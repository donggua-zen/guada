import { latestDistinctScreenshots } from "./browser-script.plugin";
import type { FileRef } from "../../../common/types/conversation.types";

function ref(url: string): FileRef {
  return {
    mediaType: "image/jpeg",
    bytes: 1024,
    name: url.split("/").pop(),
    url,
    previewUrl: url.replace("/images/", "/previews/"),
    refType: "session",
  };
}

function shots(...urls: string[]) {
  return urls.map((url) => ({
    ref: ref(url),
    absolutePath: `C:/sessions/s1/${url}`,
    width: 100,
    height: 100,
  }));
}

/**
 * 单次 browser_run 的附图封顶：
 * 所有截图都已落会话副本并列出路径，但只有最近若干张附进模型上下文。
 * 去重键是会话副本 URL（同一帧重复截图会复用同一个 ref）。
 */
describe("latestDistinctScreenshots", () => {
  it("未超限时保持原始时间序", () => {
    const out = latestDistinctScreenshots(
      shots("a.jpg", "b.jpg", "c.jpg"),
      6,
    );
    expect(out.map((s) => s.ref.url)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("超限时只取最后 N 张", () => {
    const out = latestDistinctScreenshots(
      shots("1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"),
      2,
    );
    expect(out.map((s) => s.ref.url)).toEqual(["4.jpg", "5.jpg"]);
  });

  it("同一 URL 重复出现只保留一张，且以最后一次出现的位置排序", () => {
    const out = latestDistinctScreenshots(
      shots("a.jpg", "b.jpg", "a.jpg", "c.jpg"),
      6,
    );
    expect(out.map((s) => s.ref.url)).toEqual(["b.jpg", "a.jpg", "c.jpg"]);
  });

  it("去重后仍超限：取最后 N 张", () => {
    const out = latestDistinctScreenshots(
      shots("a.jpg", "b.jpg", "c.jpg", "a.jpg"),
      2,
    );
    // 去重后顺序：b, c, a → 取最后两张
    expect(out.map((s) => s.ref.url)).toEqual(["c.jpg", "a.jpg"]);
  });

  it("没有 ref 的条目按序号兜底去重", () => {
    const out = latestDistinctScreenshots(
      [{ absolutePath: "C:/x/1.png" }, { absolutePath: "C:/x/2.png" }],
      6,
    );
    expect(out.map((s) => s.absolutePath)).toEqual(["C:/x/1.png", "C:/x/2.png"]);
  });

  it("空列表返回空", () => {
    expect(latestDistinctScreenshots([], 6)).toEqual([]);
  });
});
