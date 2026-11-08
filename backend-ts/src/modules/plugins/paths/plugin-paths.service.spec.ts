import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PluginPathsService } from "./plugin-paths.service";

describe("PluginPathsService", () => {
  let root: string;
  let service: PluginPathsService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guada-plugin-paths-"));
    service = new PluginPathsService({
      get: (key: string) => (key === "USERDATA_DIR" ? root : undefined),
    } as any);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates a plugin-scoped data dir", () => {
    const dir = service.getDataDir("guada-purge");
    expect(fs.existsSync(dir)).toBe(true);
    expect(dir.startsWith(path.join(root, "plugins-data"))).toBe(true);
  });

  it("rejects invalid plugin ids", () => {
    expect(() => service.getDataDir("../evil")).toThrow();
    expect(() => service.getDataDir("")).toThrow();
    expect(() => service.getDataDir("a/b")).toThrow();
  });

  it("removes only within the data root", () => {
    const dir = service.getDataDir("demo");
    expect(fs.existsSync(dir)).toBe(true);
    service.removeDataDir("demo");
    expect(fs.existsSync(dir)).toBe(false);
  });
});
