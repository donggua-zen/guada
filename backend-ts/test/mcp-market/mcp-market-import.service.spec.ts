import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { McpFileStore } from "../../src/modules/mcp-servers/mcp-file.store";
import {
  McpMarketImportService,
  normalizeName,
} from "../../src/modules/mcp-market/mcp-market-import.service";
import { ImportableMcpServer } from "../../src/modules/mcp-market/mcp-config.extract";

/**
 * 市场导入链路测试。
 *
 * 三条硬规则必须有测试锁住：
 * 1. 一律 disabled 落盘（即使调用方传 enabled: true）
 * 2. 不 spawn 任何进程（不碰 McpServerService / fetchTools）
 * 3. 去重靠 origin.itemId，不覆盖用户手工配置
 */
describe('McpMarketImportService', () => {
  let dir: string;
  let store: McpFileStore;
  let pluginManager: { reloadPlugin: jest.Mock };
  let service: McpMarketImportService;

  const stdioServer = (over: Partial<ImportableMcpServer> = {}): ImportableMcpServer => ({
    name: 'demo',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    needsConfiguration: false,
    configurationFields: [],
    ...over,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-market-import-'));
    process.env.MCP_DATA_DIR = dir;
    store = new McpFileStore();
    pluginManager = { reloadPlugin: jest.fn().mockResolvedValue(undefined) };
    service = new McpMarketImportService(store, pluginManager as any);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.MCP_DATA_DIR;
  });

  it('导入的服务器一律 disabled，即使传 enabled: true 也覆盖', async () => {
    const result = await service.importServers('mcpworld', 'mcpworld:abc123', [
      { ...stdioServer(), enabled: true } as any,
    ]);

    expect(result.errors).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].enabled).toBe(false);

    // 落盘内容也要是 false
    const yamlText = fs.readFileSync(
      path.join(dir, `${result.imported[0].id}.yaml`),
      'utf8',
    );
    expect(yamlText).toContain('enabled: false');
  });

  it('写入 origin 来源块，可据此判断「已安装」', async () => {
    const result = await service.importServers('mcpworld', 'mcpworld:abc123', [stdioServer()]);
    const row = result.imported[0];

    expect(row.origin).toMatchObject({
      market: 'mcpworld',
      itemId: 'mcpworld:abc123',
      version: 1,
    });
    expect(row.origin!.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const yamlText = fs.readFileSync(path.join(dir, `${row.id}.yaml`), 'utf8');
    expect(yamlText).toContain('itemId: mcpworld:abc123');
  });

  it('含占位符的条目记录 needsConfiguration 与字段清单', async () => {
    const result = await service.importServers('mcpworld', 'mcpworld:abc123', [
      stdioServer({
        name: 'prometheus',
        env: { PROM_URL: '<YOUR_URL>' },
        needsConfiguration: true,
        configurationFields: ['env.PROM_URL'],
      }),
    ]);

    expect(result.imported[0].origin).toMatchObject({
      needsConfiguration: true,
      configurationFields: ['env.PROM_URL'],
    });
  });

  it('同一 itemId 二次导入 → 原地更新，不产生重复条目', async () => {
    const first = await service.importServers('mcpworld', 'mcpworld:abc123', [stdioServer()]);
    const second = await service.importServers('mcpworld', 'mcpworld:abc123', [
      stdioServer({ args: ['-y', 'pkg-v2'] }),
    ]);

    expect(first.imported).toHaveLength(1);
    expect(second.imported).toHaveLength(0);
    expect(second.updated).toHaveLength(1);
    expect(second.updated[0].id).toBe(first.imported[0].id);
    expect(second.updated[0].args).toEqual(['-y', 'pkg-v2']);
    expect(store.list()).toHaveLength(1);
  });

  it('更新时保留用户改过的名字（origin 命中优先于 name）', async () => {
    const first = await service.importServers('mcpworld', 'mcpworld:abc123', [stdioServer()]);
    await store.update(first.imported[0].id, { name: '我改的名字' });

    const second = await service.importServers('mcpworld', 'mcpworld:abc123', [stdioServer()]);

    expect(second.updated[0].name).toBe('我改的名字');
  });

  it('同名但无 origin 的手工服务器 → 加后缀新建，不覆盖', async () => {
    const manual = await store.create({ name: 'demo', command: 'node', enabled: true });

    const result = await service.importServers('mcpworld', 'mcpworld:abc123', [stdioServer()]);

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].name).toBe('demo (2)');
    // 手工配置原样保留
    const kept = store.getRow(manual.id)!;
    expect(kept.command).toBe('node');
    expect(kept.enabled).toBe(true);
    expect(kept.origin).toBeNull();
  });

  it('一次导入多个服务器，逐条落盘', async () => {
    const result = await service.importServers('skillhub_mcp', 'skillhub_mcp:pack', [
      stdioServer({ name: 'a' }),
      { name: 'b', type: 'streamableHttp', url: 'https://x/mcp', needsConfiguration: false, configurationFields: [] },
    ]);

    expect(result.imported).toHaveLength(2);
    expect(store.list()).toHaveLength(2);
    const http = store.list().find((s) => s.name === 'b')!;
    expect(http.type).toBe('streamableHttp');
    expect(http.url).toBe('https://x/mcp');
    expect(http.command).toBeNull();
  });

  it('单条非法配置只影响自己，其余照常导入', async () => {
    const result = await service.importServers('mcpworld', 'mcpworld:abc123', [
      { name: 'bad', type: 'stdio', needsConfiguration: false, configurationFields: [] }, // 缺 command
      stdioServer({ name: 'good' }),
    ]);

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].name).toBe('good');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe('bad');
  });

  it('HTTP 配置缺 url 时被拒', async () => {
    const result = await service.importServers('mcpworld', 'x:1', [
      { name: 'noUrl', type: 'streamableHttp', needsConfiguration: false, configurationFields: [] },
    ]);

    expect(result.imported).toHaveLength(0);
    expect(result.errors[0].message).toContain('url');
  });

  it('空列表直接返回错误，不写盘', async () => {
    const result = await service.importServers('mcpworld', 'x:1', []);

    expect(result.imported).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(store.list()).toHaveLength(0);
  });

  it('导入后触发 mcp 插件重载（让工具包索引跟上）', async () => {
    await service.importServers('mcpworld', 'mcpworld:abc123', [stdioServer()]);

    expect(pluginManager.reloadPlugin).toHaveBeenCalledWith('mcp');
  });

  it('插件重载失败不影响「已落盘」的结论', async () => {
    pluginManager.reloadPlugin.mockRejectedValueOnce(new Error('reload boom'));

    const result = await service.importServers('mcpworld', 'mcpworld:abc123', [stdioServer()]);

    expect(result.imported).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(store.list()).toHaveLength(1);
  });

  it('导入全程不启动任何进程（只写文件）', async () => {
    // 若实现里误用 McpServerService.createServer，会触发 fetchToolsForCreate 起子进程；
    // 这里用 spy 锁住「store 的写方法被调用、而插件注册只发生一次」的形态。
    const createSpy = jest.spyOn(store, 'create');
    const writeToolsSpy = jest.spyOn(store, 'writeTools');

    await service.importServers('mcpworld', 'mcpworld:abc123', [stdioServer()]);

    expect(createSpy).toHaveBeenCalledTimes(1);
    // 关键断言：导入不抓工具，因此不写 tools 缓存
    expect(writeToolsSpy).not.toHaveBeenCalled();
  });
});

describe('normalizeName', () => {
  it('统一大小写与分隔符，用于兜底判重', () => {
    expect(normalizeName('My Server')).toBe('my-server');
    expect(normalizeName('my_server')).toBe('my-server');
    expect(normalizeName('  MY  SERVER ')).toBe('my-server');
  });
});
