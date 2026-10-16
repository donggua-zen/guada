import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MCP_TOOLS_SUFFIX,
  McpFileStore,
} from '../../src/modules/mcp-servers/mcp-file.store';
import {
  META_DOMAIN_MCP,
  MetadataBootstrapGate,
} from '../../src/common/database/metadata-bootstrap.gate';

/**
 * MCP 服务器文件存储测试
 *
 * 关注点：id = 文件名（引用零改写）、配置与工具缓存分离、非法文件隔离、
 * 以及「YAML 里声明的 id 让位于文件名」这条与 bots/providers 一致的约定。
 */
describe('McpFileStore', () => {
  let dir: string;
  let store: McpFileStore;
  let gate: MetadataBootstrapGate;

  function mkStore(): McpFileStore {
    // 门控是纯内存类，直接放行，避免测试挂在 30s 超时上
    gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_MCP);
    return new McpFileStore(gate);
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-store-'));
    process.env.MCP_DATA_DIR = dir;

    fs.writeFileSync(
      path.join(dir, 'srv-http.yaml'),
      [
        'name: 联网搜索',
        'type: streamableHttp',
        'url: https://example.com/mcp',
        'enabled: true',
        'headers:',
        '  Authorization: Bearer test-key',
        'createdAt: 2026-08-02T04:47:18.999Z',
        'updatedAt: 2026-08-02T04:47:18.999Z',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dir, 'srv-stdio.yaml'),
      [
        'name: 本地工具',
        'type: stdio',
        'command: npx',
        'args: [-y, some-mcp]',
        'env:',
        '  PORT: 8080',
        'enabled: false',
        'createdAt: 2026-08-03T04:00:00.000Z',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'broken.yaml'), 'name: [unclosed', 'utf8');

    store = mkStore();
  });

  afterEach(() => {
    delete process.env.MCP_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('加载全部实例；非法文件隔离并上报', async () => {
    await store.initialize();

    const ids = store.list().map((s) => s.id).sort();
    expect(ids).toEqual(['srv-http', 'srv-stdio']);
    expect(store.listLoadErrors().map((e) => e.file)).toEqual(['broken.yaml']);
  });

  it('list 按 createdAt 降序，listEnabled 只留启用的', async () => {
    await store.initialize();

    // srv-stdio(08-03) 比 srv-http(08-02) 新 → 排前面
    expect(store.list().map((s) => s.id)).toEqual(['srv-stdio', 'srv-http']);
    expect(store.listEnabled().map((s) => s.id)).toEqual(['srv-http']);
  });

  it('解析配置：headers 保留、env 值统一转字符串、缺省 enabled 为 true', async () => {
    await store.initialize();

    const http = store.getRow('srv-http')!;
    expect(http.name).toBe('联网搜索');
    expect(http.headers).toEqual({ Authorization: 'Bearer test-key' });
    expect(http.enabled).toBe(true);

    const stdio = store.getRow('srv-stdio')!;
    expect(stdio.args).toEqual(['-y', 'some-mcp']);
    // YAML 里 PORT: 8080 会被解析成数字，统一转字符串供 stdio env 使用
    expect(stdio.env).toEqual({ PORT: '8080' });
    expect(stdio.enabled).toBe(false);
  });

  it('解析 timeoutMs：数字与带引号的字符串等价，非法值视为未设置', async () => {
    // 手工编辑 YAML 时常把数字写成带引号的字符串；非法值不该让整份配置加载失败
    fs.writeFileSync(path.join(dir, 't-num.yaml'), 'name: 数字\ntimeoutMs: 600000\n', 'utf8');
    fs.writeFileSync(path.join(dir, 't-str.yaml'), 'name: 字符串\ntimeoutMs: "90000"\n', 'utf8');
    fs.writeFileSync(path.join(dir, 't-bad.yaml'), 'name: 非法\ntimeoutMs: abc\n', 'utf8');
    fs.writeFileSync(path.join(dir, 't-zero.yaml'), 'name: 零\ntimeoutMs: 0\n', 'utf8');
    fs.writeFileSync(path.join(dir, 't-none.yaml'), 'name: 未设置\n', 'utf8');
    await store.reload();

    expect(store.getRow('t-num')!.timeoutMs).toBe(600000);
    expect(store.getRow('t-str')!.timeoutMs).toBe(90000);
    expect(store.getRow('t-bad')!.timeoutMs).toBeNull();
    expect(store.getRow('t-zero')!.timeoutMs).toBeNull();
    expect(store.getRow('t-none')!.timeoutMs).toBeNull();
    // 非法值只是被忽略，文件本身仍然可用
    expect(store.listLoadErrors()).toHaveLength(1);
  });

  it('timeoutMs 落盘：设置时写入，未设置时不占字段', async () => {
    await store.reload();

    await store.update('srv-http', { timeoutMs: 600000 });
    expect(fs.readFileSync(path.join(dir, 'srv-http.yaml'), 'utf8')).toContain(
      'timeoutMs: 600000',
    );

    const created = await store.create({ name: '新服务器', command: 'node' });
    expect(
      fs.readFileSync(path.join(dir, `${created.id}.yaml`), 'utf8'),
    ).not.toContain('timeoutMs');
  });

  it('工具缓存与配置分离：写 tools 落到 .tools.json，读时合并进行视图', async () => {
    await store.initialize();

    const tools = {
      web_search: { description: '联网搜索', inputSchema: { type: 'object' } },
    };
    await store.writeTools('srv-http', tools);

    // 正本是独立文件，不污染配置 YAML
    const toolsPath = path.join(dir, `srv-http${MCP_TOOLS_SUFFIX}`);
    expect(fs.existsSync(toolsPath)).toBe(true);
    const dumped = JSON.parse(fs.readFileSync(toolsPath, 'utf8'));
    expect(dumped.tools).toEqual(tools);
    expect(typeof dumped.fetchedAt).toBe('string');

    const configYaml = fs.readFileSync(path.join(dir, 'srv-http.yaml'), 'utf8');
    expect(configYaml).not.toContain('web_search');

    // 行视图合并 tools；未抓取过的为 null
    expect(store.getRow('srv-http')!.tools).toEqual(tools);
    expect(store.getRow('srv-stdio')!.tools).toBeNull();
  });

  it('重载后工具缓存仍可读回（不依赖内存）', async () => {
    await store.initialize();
    await store.writeTools('srv-http', { ping: { description: 'p' } });

    await store.reload();
    expect(store.getRow('srv-http')!.tools).toEqual({ ping: { description: 'p' } });
  });

  it('create 生成安全 id；update 禁改 id 并刷新 updatedAt', async () => {
    await store.initialize();

    const created = await store.create({
      name: '新建',
      type: 'streamableHttp',
      url: 'https://x.example/mcp',
    });
    expect(created.id).toMatch(/^mcp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(fs.existsSync(path.join(dir, `${created.id}.yaml`))).toBe(true);

    const updated = await store.update(created.id, {
      name: '改名后',
      id: 'hacked',
    } as any);
    expect(updated!.id).toBe(created.id);
    expect(updated!.name).toBe('改名后');
    expect(fs.existsSync(path.join(dir, 'hacked.yaml'))).toBe(false);
  });

  it('delete 同时移除配置与工具缓存，返回 false 表示不存在', async () => {
    await store.initialize();
    await store.writeTools('srv-http', { a: {} });

    expect(await store.delete('srv-http')).toBe(true);
    expect(fs.existsSync(path.join(dir, 'srv-http.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(dir, `srv-http${MCP_TOOLS_SUFFIX}`))).toBe(false);
    expect(store.getRow('srv-http')).toBeUndefined();

    expect(await store.delete('srv-http')).toBe(false);
  });

  it('YAML 里声明的 id 让位于文件名（同 bots/providers 约定）', async () => {
    fs.writeFileSync(
      path.join(dir, 'real-name.yaml'),
      'id: declared-elsewhere\nname: X\n',
      'utf8',
    );
    await store.reload();

    expect(store.getRow('real-name')).toBeDefined();
    expect(store.getRow('declared-elsewhere')).toBeUndefined();
  });

  it('忽略点文件与工具缓存文件，不当作实例加载', async () => {
    fs.writeFileSync(path.join(dir, '.migrated-mcp'), 'marker\n', 'utf8');
    fs.writeFileSync(
      path.join(dir, `orphan${MCP_TOOLS_SUFFIX}`),
      JSON.stringify({ tools: { x: {} } }),
      'utf8',
    );
    await store.reload();

    expect(store.list().map((s) => s.id).sort()).toEqual(['srv-http', 'srv-stdio']);
  });

  it('writeDirect 写配置 + 工具缓存（迁移导出用）', async () => {
    const row = {
      id: 'imported',
      name: '迁移来的',
      url: 'https://imported.example/mcp',
      type: 'sse',
      description: null,
      headers: null,
      command: null,
      args: null,
      env: null,
      cwd: null,
      enabled: false,
      tools: { t1: { description: 'd1' } },
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    await store.writeDirect(row as any);
    await store.reload();

    const back = store.getRow('imported')!;
    expect(back.name).toBe('迁移来的');
    expect(back.enabled).toBe(false);
    expect(back.tools).toEqual({ t1: { description: 'd1' } });
    expect(fs.existsSync(path.join(dir, `imported${MCP_TOOLS_SUFFIX}`))).toBe(true);
  });
});
