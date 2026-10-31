import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PluginsController } from "../../src/modules/plugins/plugins.controller";

/**
 * 插件图标端点：内置插件（无插件目录）回退 STATIC_DIR，
 * 外部插件（有插件目录）仍按插件目录解析。
 */
describe("PluginsController.getPluginIcon", () => {
  let tmpRoot: string;
  let staticDir: string;
  let pluginDir: string;
  let originalStaticDir: string | undefined;
  let pluginManager: any;
  let externalLoader: any;
  let controller: PluginsController;

  function createRes() {
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: undefined as any,
      redirectTo: undefined as string | undefined,
      filePath: undefined as string | undefined,
      headersSent: false,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      send(body?: any) {
        res.body = body;
        return res;
      },
      redirect(url: string) {
        res.statusCode = 302;
        res.redirectTo = url;
        return res;
      },
      type(t: string) {
        res.headers["Content-Type"] = t;
        return res;
      },
      setHeader(key: string, value: string) {
        res.headers[key] = value;
        return res;
      },
      sendFile(filePath: string, _opts?: any, cb?: (err?: any) => void) {
        res.filePath = filePath;
        if (typeof cb === "function") cb(null);
        return res;
      },
    };
    return res;
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gd-plugin-icon-"));
    staticDir = path.join(tmpRoot, "static");
    pluginDir = path.join(tmpRoot, "external-plugin");
    fs.mkdirSync(path.join(staticDir, "images", "plugins"), { recursive: true });
    fs.mkdirSync(path.join(pluginDir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(staticDir, "images", "plugins", "file.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    fs.writeFileSync(
      path.join(pluginDir, "assets", "logo.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );

    originalStaticDir = process.env.STATIC_DIR;
    process.env.STATIC_DIR = staticDir;

    pluginManager = { getPlugin: jest.fn() };
    externalLoader = { getPluginPath: jest.fn() };
    controller = new PluginsController(
      pluginManager,
      externalLoader,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => {
    if (originalStaticDir === undefined) delete process.env.STATIC_DIR;
    else process.env.STATIC_DIR = originalStaticDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function setPlugin(manifest: any) {
    pluginManager.getPlugin.mockReturnValue({ manifest });
  }

  it("内置插件（无插件目录）从 STATIC_DIR 出图", async () => {
    setPlugin({ id: "file", icon: "images/plugins/file.svg" });
    externalLoader.getPluginPath.mockReturnValue(undefined);

    const res = createRes();
    await controller.getPluginIcon("file", undefined, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/svg+xml");
    expect(res.headers["Cache-Control"]).toBe("public, no-cache");
    expect(res.filePath).toBe(path.join(staticDir, "images", "plugins", "file.svg"));
  });

  it("带 rev 时使用长缓存（URL 由 mtime 生成，内容变更即换 URL）", async () => {
    setPlugin({ id: "file", icon: "images/plugins/file.svg" });
    externalLoader.getPluginPath.mockReturnValue(undefined);

    const res = createRes();
    await controller.getPluginIcon("file", "abc123", res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("外部插件仍按插件目录解析（回归保护）", async () => {
    setPlugin({ id: "hello-plugin", icon: "assets/logo.svg" });
    externalLoader.getPluginPath.mockReturnValue(pluginDir);

    const res = createRes();
    await controller.getPluginIcon("hello-plugin", undefined, res);

    expect(res.statusCode).toBe(200);
    expect(res.filePath).toBe(path.join(pluginDir, "assets", "logo.svg"));
  });

  it("data URI 走 302", async () => {
    const dataUri = "data:image/svg+xml;base64,PHN2Zy8+";
    setPlugin({ id: "inline", icon: dataUri });

    const res = createRes();
    await controller.getPluginIcon("inline", undefined, res);

    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toBe(dataUri);
  });

  it("http URL 走 302", async () => {
    setPlugin({ id: "remote", icon: "https://example.com/logo.png" });

    const res = createRes();
    await controller.getPluginIcon("remote", undefined, res);

    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toBe("https://example.com/logo.png");
  });

  it("目录穿越返回 403", async () => {
    setPlugin({ id: "evil", icon: "../../escape.svg" });
    externalLoader.getPluginPath.mockReturnValue(undefined);

    const res = createRes();
    await controller.getPluginIcon("evil", undefined, res);

    expect(res.statusCode).toBe(403);
    expect(res.filePath).toBeUndefined();
  });

  it("非白名单扩展名返回 403", async () => {
    setPlugin({ id: "text", icon: "images/plugins/notes.txt" });
    externalLoader.getPluginPath.mockReturnValue(undefined);

    const res = createRes();
    await controller.getPluginIcon("text", undefined, res);

    expect(res.statusCode).toBe(403);
  });

  it("图标文件不存在返回 404", async () => {
    setPlugin({ id: "missing", icon: "images/plugins/missing.svg" });
    externalLoader.getPluginPath.mockReturnValue(undefined);

    const res = createRes();
    await controller.getPluginIcon("missing", undefined, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("Icon file not found");
  });

  it("iconRev 返回 mtime 版本号，替换文件后变化", () => {
    const rev1 = (controller as any).iconRev("file", "images/plugins/file.svg");
    expect(rev1).toMatch(/^[0-9a-z]+$/);

    // 改写文件并推进 mtime
    const iconFile = path.join(staticDir, "images", "plugins", "file.svg");
    fs.writeFileSync(iconFile, "<svg/>");
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(iconFile, future, future);

    const rev2 = (controller as any).iconRev("file", "images/plugins/file.svg");
    expect(rev2).not.toBe(rev1);
  });

  it("iconRev 对 data/http/非法路径返回空串", () => {
    expect((controller as any).iconRev("x", "data:image/svg+xml;base64,AA==")).toBe("");
    expect((controller as any).iconRev("x", "https://example.com/a.svg")).toBe("");
    expect((controller as any).iconRev("x", "../../escape.svg")).toBe("");
    expect((controller as any).iconRev("x", undefined)).toBe("");
  });

  it("插件不存在或未声明 icon 返回 404", async () => {
    pluginManager.getPlugin.mockReturnValue(undefined);

    const res = createRes();
    await controller.getPluginIcon("nope", undefined, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("No icon");
  });
});
