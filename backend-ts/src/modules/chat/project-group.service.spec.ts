import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ProjectGroupService } from "./project-group.service";
import { SessionMetaStore } from "./session-meta.store";
import {
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";
import { normalizeWorkspaceKey } from "../../common/utils/workspace-key.util";

/**
 * 手动注册项目（侧栏快捷入口）：
 * - 只接受已存在的绝对目录
 * - 公共目录 / 自动生成目录拒绝
 * - 同路径幂等，不覆盖已改名分组
 */
describe("ProjectGroupService 手动注册项目", () => {
  let tmpRoot: string;
  let sessionsBase: string;
  let baseDir: string;
  let store: SessionMetaStore;
  let service: ProjectGroupService;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-group-service-"));
    sessionsBase = path.join(tmpRoot, "sessions");
    baseDir = path.join(tmpRoot, "workspace");
    fs.mkdirSync(sessionsBase, { recursive: true });
    fs.mkdirSync(baseDir, { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;
  });

  afterAll(() => {
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  afterEach(() => {
    store?.onModuleDestroy();
  });

  beforeEach(async () => {
    fs.rmSync(sessionsBase, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.mkdirSync(sessionsBase, { recursive: true });

    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_SESSIONS);
    store = new SessionMetaStore(gate);
    await store.initialize();

    service = new ProjectGroupService(store, {} as any, {
      getEffectiveBaseDir: async () => baseDir,
    } as any);
  });

  it("注册已存在的真实目录，名称取目录末段", async () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
    const group = await service.createGroup({ path: dir });

    expect(group.pathKey).toBe(normalizeWorkspaceKey(dir));
    expect(group.name).toBe(path.basename(dir));
    expect(await store.listProjectGroups()).toHaveLength(1);
  });

  it("同路径重复注册幂等，且不覆盖用户改名", async () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "proj-"));
    const first = await service.createGroup({ path: dir });
    await store.renameProjectGroup(first.id, "我的项目");

    const second = await service.createGroup({ path: dir });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("我的项目");
    expect(await store.listProjectGroups()).toHaveLength(1);
  });

  it("公共目录拒绝注册", async () => {
    const publicDir = path.join(baseDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });

    await expect(
      service.createGroup({ path: publicDir }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await store.listProjectGroups()).toHaveLength(0);
  });

  it("不存在的目录 / 相对路径 / 文件 均拒绝", async () => {
    await expect(
      service.createGroup({ path: path.join(tmpRoot, "missing-dir") }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(service.createGroup({ path: "relative/path" })).rejects.toMatchObject({
      status: 400,
    });

    const file = path.join(tmpRoot, "not-a-dir.txt");
    fs.writeFileSync(file, "x");
    await expect(service.createGroup({ path: file })).rejects.toMatchObject({
      status: 400,
    });
  });
});
