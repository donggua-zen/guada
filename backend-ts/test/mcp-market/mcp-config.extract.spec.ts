import {
  extractFencedBlocks,
  extractMcpConfig,
  isPlaceholder,
  normalizeServer,
  parseLenientJson,
  scoreConfig,
  scoreServer,
  stripJsonComments,
} from "../../src/modules/mcp-market/mcp-config.extract";

/**
 * MCP 市场配置抽取测试。
 *
 * 关注点：从人类文档里选出「真的能跑」的那一段配置，而不是第一个代码块。
 */
describe('mcp-config.extract', () => {
  describe('extractFencedBlocks', () => {
    it('抠出所有围栏块（语言标记可有可无）', () => {
      const md = [
        '前言',
        '```json',
        '{"a":1}',
        '```',
        '中间',
        '```bash',
        'npm i x',
        '```',
      ].join('\n');

      expect(extractFencedBlocks(md)).toEqual(['{"a":1}', 'npm i x']);
    });

    it('忽略空的围栏块', () => {
      expect(extractFencedBlocks('```json\n\n```')).toEqual([]);
    });
  });

  describe('isPlaceholder', () => {
    it.each([
      ['${API_KEY}'],
      ['<YOUR_TOKEN>'],
      ['sk-xxxxxxxx'],
      ['your_api_key'],
      ['api key here'],
    ])('识别占位符 %s', (value) => {
      expect(isPlaceholder(value)).toBe(true);
    });

    it.each([
      ['npx'],
      ['@modelcontextprotocol/server-github'],
      ['https://api.example.com/mcp'],
      [''],
    ])('正常值 %s 不误判', (value) => {
      expect(isPlaceholder(value)).toBe(false);
    });
  });

  describe('scoreServer', () => {
    it('npx 系最高，docker 最低', () => {
      const npx = scoreServer({ command: 'npx', args: ['-y', 'pkg'] });
      const npm = scoreServer({ command: 'npm', args: ['i', 'pkg'] });
      const docker = scoreServer({ command: 'docker', args: ['run', 'x'] });

      expect(npx).toBeGreaterThan(npm);
      expect(npm).toBeGreaterThan(docker);
    });

    it('npx 缺 -y 扣分（非交互场景会挂起）', () => {
      const withYes = scoreServer({ command: 'npx', args: ['-y', 'pkg'] });
      const withoutYes = scoreServer({ command: 'npx', args: ['pkg'] });

      expect(withoutYes).toBeLessThan(withYes);
    });

    it('命令含占位符重罚，保证不会被选中', () => {
      const placeholder = scoreServer({ command: '<YOUR_CMD>' });
      const docker = scoreServer({ command: 'docker', args: ['run', 'x'] });

      expect(placeholder).toBeLessThan(docker);
    });

    it('纯 HTTP 配置有基础分', () => {
      expect(scoreServer({ url: 'https://example.com/mcp' })).toBeGreaterThan(50);
    });
  });

  describe('scoreConfig', () => {
    it('取平均分，避免「塞更多服务器」反而占优', () => {
      const one = scoreConfig({ mcpServers: { a: { command: 'npx', args: ['-y'] } } });
      const two = scoreConfig({
        mcpServers: {
          a: { command: 'npx', args: ['-y'] },
          b: { command: 'docker', args: ['run'] },
        },
      });

      expect(one).toBeGreaterThan(two);
    });
  });

  describe('normalizeServer', () => {
    it('stdio：command/args/env 全量归一，env 值转字符串', () => {
      const server = normalizeServer('demo', {
        command: 'npx',
        args: ['-y', 'pkg'],
        env: { PORT: 8080, KEY: 'abc' },
      });

      expect(server).toEqual({
        name: 'demo',
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'pkg'],
        env: { PORT: '8080', KEY: 'abc' },
        needsConfiguration: false,
        configurationFields: [],
      });
    });

    it('有 command 时优先判为 stdio（即使同时给了 url）', () => {
      const server = normalizeServer('demo', {
        command: 'node',
        url: 'https://ignored.example',
      });

      expect(server!.type).toBe('stdio');
      expect(server!.url).toBeUndefined();
    });

    it('HTTP：type 归一，sse 保留，其余归为 streamableHttp', () => {
      expect(normalizeServer('a', { type: 'sse', url: 'https://x/mcp' })!.type).toBe('sse');
      expect(normalizeServer('b', { type: 'streamable_http', url: 'https://x/mcp' })!.type).toBe(
        'streamableHttp',
      );
      expect(normalizeServer('c', { url: 'https://x/mcp' })!.type).toBe('streamableHttp');
    });

    it('支持 transport 嵌套写法', () => {
      const server = normalizeServer('demo', {
        transport: { type: 'stdio', command: 'uvx', args: ['pkg'] },
      });

      expect(server!.command).toBe('uvx');
      expect(server!.args).toEqual(['pkg']);
    });

    it('标记占位符字段（env / url / headers）', () => {
      const stdio = normalizeServer('a', {
        command: 'npx',
        args: ['-y', 'pkg'],
        env: { TOKEN: '<YOUR_TOKEN>', OK: 'fine' },
      });
      expect(stdio!.needsConfiguration).toBe(true);
      expect(stdio!.configurationFields).toEqual(['env.TOKEN']);

      const http = normalizeServer('b', {
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer ${TOKEN}' },
      });
      expect(http!.configurationFields).toEqual(['headers.Authorization']);
    });

    it('既无 command 又无 url 时返回 null', () => {
      expect(normalizeServer('x', { description: 'nothing' })).toBeNull();
      expect(normalizeServer('x', null)).toBeNull();
    });
  });

  describe('extractMcpConfig', () => {
    it('整段裸 JSON 优先', () => {
      const result = extractMcpConfig('{"mcpServers":{"a":{"command":"npx","args":["-y","p"]}}}');
      expect(result!.servers).toHaveLength(1);
      expect(result!.servers[0].name).toBe('a');
    });

    it('多块时选可移植性最高的那个（docker 在前也选 npx）', () => {
      const md = [
        'Docker 方式：',
        '```json',
        '{"mcpServers":{"x":{"command":"docker","args":["run","img"]}}}',
        '```',
        'npx 方式：',
        '```json',
        '{"mcpServers":{"x":{"command":"npx","args":["-y","pkg"]}}}',
        '```',
      ].join('\n');

      const result = extractMcpConfig(md);
      expect(result!.servers[0].command).toBe('npx');
    });

    it('跳过不含 mcpServers 的代码块', () => {
      const md = [
        '```json',
        '{"other":1}',
        '```',
        '```json',
        '{"mcpServers":{"y":{"url":"https://x/mcp"}}}',
        '```',
      ].join('\n');

      const result = extractMcpConfig(md);
      expect(result!.servers[0].name).toBe('y');
    });

    it('空 mcpServers 不算有效配置', () => {
      expect(extractMcpConfig('```json\n{"mcpServers":{}}\n```')).toBeNull();
    });

    it('没有配置块时返回 null', () => {
      expect(extractMcpConfig('# 只是一个说明文档\n没有代码')).toBeNull();
    });

    it('支持一次导出多个服务器', () => {
      const md =
        '```json\n{"mcpServers":{"a":{"command":"npx","args":["-y","p1"]},"b":{"url":"https://x/mcp"}}}\n```';
      const result = extractMcpConfig(md);

      expect(result!.servers.map((s) => s.name).sort()).toEqual(['a', 'b']);
      expect(result!.servers.find((s) => s.name === 'b')!.type).toBe('streamableHttp');
    });
  });

  /**
   * 真实世界的 readme 大量使用 JSONC（带注释 / 尾逗号）。
   * 这类条目曾经整条报「未找到可导入的配置」（DNSPod MCP 就是实例）。
   */
  describe('JSONC 容错（注释 / 尾逗号）', () => {
    it('stripJsonComments 去掉行注释与块注释', () => {
      const input = ['{', '  "a": 1, // 行注释', '  /* 块注释 */', '  "b": 2', '}'].join('\n');
      expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1, b: 2 });
    });

    it('不破坏字符串里的 // 与 /*（URL 必须完好）', () => {
      const input = '{"url":"https://api.example.com/a//b","note":"/*not a comment*/"}';
      expect(JSON.parse(stripJsonComments(input))).toEqual({
        url: 'https://api.example.com/a//b',
        note: '/*not a comment*/',
      });
    });

    it('去掉尾逗号（对象与数组）', () => {
      const input = '{"a":[1,2,],"b":3,}';
      expect(JSON.parse(stripJsonComments(input))).toEqual({ a: [1, 2], b: 3 });
    });

    it('不误删字符串里的尾逗号', () => {
      const input = '{"a":"x,}"}';
      expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 'x,}' });
    });

    it('parseLenientJson 先试严格 JSON，再回落宽容解析', () => {
      expect(parseLenientJson('{"a":1}')).toEqual({ a: 1 });
      expect(parseLenientJson('{"a":1, // c\n}')).toEqual({ a: 1 });
      expect(parseLenientJson('not json')).toBeUndefined();
    });

    it('DNSPod 真实样本：带注释的配置块能被抽取', () => {
      const md = [
        '```json',
        '{',
        '  "mcpServers": {',
        '    "tencent-dnspod": {',
        '      "command": "uv",',
        '      "args": ["run", "mcp-server-dnspod"],',
        '      "env": {',
        '        "TENCENTCLOUD_SECRET_ID": "YOUR_SECRET_ID_HERE",',
        '        "TENCENTCLOUD_SECRET_KEY": "YOUR_SECRET_KEY_HERE",',
        '        "TENCENTCLOUD_REGION": "ap-guangzhou"  //可选参数, 指定地域',
        '      }',
        '    }',
        '  }',
        '}',
        '```',
      ].join('\n');

      const result = extractMcpConfig(md);
      expect(result).not.toBeNull();
      expect(result!.servers).toHaveLength(1);
      expect(result!.servers[0]).toMatchObject({
        name: 'tencent-dnspod',
        type: 'stdio',
        command: 'uv',
        args: ['run', 'mcp-server-dnspod'],
      });
      // 占位符识别同样要生效
      expect(result!.servers[0].needsConfiguration).toBe(true);
      expect(result!.servers[0].configurationFields).toEqual([
        'env.TENCENTCLOUD_SECRET_ID',
        'env.TENCENTCLOUD_SECRET_KEY',
      ]);
    });

    it('整段裸 JSONC 也能抽取', () => {
      const result = extractMcpConfig(
        '{"mcpServers":{"x":{"command":"npx","args":["-y","p"]}},} // trailing',
      );
      expect(result!.servers[0].name).toBe('x');
    });

    it('代码块开头的 # 注释行被忽略（weather-mcp-server 实例）', () => {
      const md = [
        '```json',
        '# claude_desktop_config.json',
        '# 可以通过以下路径找到位置：',
        '{',
        '  "mcpServers": {',
        '    "w": { "command": "uv", "args": ["run", "server.py"] }',
        '  }',
        '}',
        '```',
      ].join('\n');

      expect(extractMcpConfig(md)!.servers[0].name).toBe('w');
    });

    it('字符串里的 # 不被当作注释', () => {
      const input = '{"a":"# not a comment"}';
      expect(JSON.parse(stripJsonComments(input))).toEqual({ a: '# not a comment' });
    });
  });

  /**
   * 真实 readme 里还有一批「不符合标准 mcpServers 结构」的写法。
   * 这些曾经全部报「未找到可导入的配置」，属于白丢条目。
   */
  describe('结构变体归一（coerceToMcpServers）', () => {
    it('外层键名写成 servers 时改名为 mcpServers（tdesign 实例）', () => {
      const md = [
        '```json',
        '{',
        '  "servers": {',
        '    "tdesign-mcp-server": { "command": "npx", "args": ["-y", "tdesign-mcp-server"] }',
        '  }',
        '}',
        '```',
      ].join('\n');

      const result = extractMcpConfig(md);
      expect(result!.servers[0]).toMatchObject({
        name: 'tdesign-mcp-server',
        command: 'npx',
      });
    });

    it('少写外层 mcpServers 时自动补壳（chatgpt-mcp 实例）', () => {
      const md = [
        '```json',
        '"chatgpt-mcp": {',
        '  "command": "npx",',
        '  "args": ["claude-chatgpt-mcp"]',
        '}',
        '```',
      ].join('\n');

      // 注意：这不是合法 JSON（缺外层花括号），应返回 null 而不是瞎猜
      expect(extractMcpConfig(md)).toBeNull();

      // 补了花括号（但少 mcpServers 层）才应被归一
      const fixed = '```json\n{"chatgpt-mcp":{"command":"npx","args":["x"]}}\n```';
      const result = extractMcpConfig(fixed);
      expect(result!.servers[0].name).toBe('chatgpt-mcp');
    });

    it('只贴单个服务器内容时用条目名兜底', () => {
      const md = '```json\n{"command":"npx","args":["-y","pkg"]}\n```';
      const result = extractMcpConfig(md, 'my-entry');

      expect(result!.servers[0]).toMatchObject({
        name: 'my-entry',
        command: 'npx',
      });
    });

    it('普通无关对象不会被误判成服务器', () => {
      expect(extractMcpConfig('```json\n{"version":1,"foo":"bar"}\n```')).toBeNull();
    });

    it('servers 里的值不像服务器时也不归一（避免误判）', () => {
      const md = '```json\n{"servers":{"a":{"x":1}}}\n```';
      expect(extractMcpConfig(md)).toBeNull();
    });
  });
});
