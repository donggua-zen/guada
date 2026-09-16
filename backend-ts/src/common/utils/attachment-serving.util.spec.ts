import { resolveAttachmentResponseHeaders } from "./attachment-serving.util";

/**
 * 附件目录静态响应的头策略测试。
 *
 * 这是安全修复的回归防线：附件目录与前端同源且用户可写，
 * 一旦把 .html/.svg 放开成 inline，上传的脚本就能在应用同源下执行并读走
 * localStorage 里的 token。
 */
describe("resolveAttachmentResponseHeaders", () => {
  it("位图 inline，并给出真实 Content-Type（<img src> 需要能渲染）", () => {
    expect(resolveAttachmentResponseHeaders("/data/images/20260915/a.jpg")).toEqual({
      "Content-Type": "image/jpeg",
      "Content-Disposition": "inline; charset=utf-8",
    });
    expect(resolveAttachmentResponseHeaders("/data/previews/b.png")["Content-Type"]).toBe(
      "image/png",
    );
    expect(resolveAttachmentResponseHeaders("/x/c.WEBP")["Content-Type"]).toBe("image/webp");
  });

  it("位图分支不设 nosniff（历史文件存在「扩展名 .png、字节是 JPEG」，加了就显示不出来）", () => {
    const headers = resolveAttachmentResponseHeaders("/data/images/a.png");
    expect(headers["X-Content-Type-Options"]).toBeUndefined();
  });

  it("html 强制下载 + 二进制类型（存储型 XSS 的堵口）", () => {
    expect(resolveAttachmentResponseHeaders("/data/uploads/x.html")).toEqual({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("svg 也强制下载（它是 image/* 但可内嵌脚本）", () => {
    const headers = resolveAttachmentResponseHeaders("/data/uploads/x.svg");
    expect(headers["Content-Disposition"]).toContain("attachment");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("其余可渲染/可执行类型一律下载", () => {
    const names = ["a.htm", "a.xml", "a.js", "a.pdf", "a.svgz", "noext", "a"];
    const leakedInline = names.filter(
      (name) =>
        resolveAttachmentResponseHeaders(`/data/uploads/${name}`)[
          "Content-Disposition"
        ] !== "attachment; charset=utf-8",
    );
    // 失败时直接列出被误判为可 inline 的文件名
    expect(leakedInline).toEqual([]);
  });

  it("大小写无关（Windows 上扩展名大小写不可靠）", () => {
    expect(
      resolveAttachmentResponseHeaders("/data/uploads/X.HTML")["Content-Disposition"],
    ).toContain("attachment");
    expect(resolveAttachmentResponseHeaders("/data/images/A.PNG")["Content-Type"]).toBe(
      "image/png",
    );
  });
});
