import {
  findSource,
  isValidSlug,
  mcpworldDetailToMarkdown,
  mcpworldSource,
  skillhubSource,
  slugOf,
} from "../../src/modules/mcp-market/market-sources";

/**
 * 市场来源解析测试。
 *
 * 上游结构随时可能变，所以每个解析器都要做到「脏数据只丢该条，不炸整页」。
 */
describe('market-sources', () => {
  describe('slug 处理', () => {
    it('从 source:id 中取出 slug', () => {
      expect(slugOf('mcpworld:abc123')).toBe('abc123');
      expect(slugOf('skillhub_mcp:some-slug')).toBe('some-slug');
      expect(slugOf('no-colon')).toBe('no-colon');
    });

    it('slug 合法性拦住路径穿越与注入', () => {
      expect(isValidSlug('github-mcp')).toBe(true);
      expect(isValidSlug('a.b_c-1')).toBe(true);
      expect(isValidSlug('../etc/passwd')).toBe(false);
      expect(isValidSlug('a/b')).toBe(false);
      expect(isValidSlug('a?x=1')).toBe(false);
      expect(isValidSlug('')).toBe(false);
    });
  });

  describe('skillhub', () => {
    it('解析标准榜单结构', () => {
      const body = {
        items: [
          {
            slug: 'github-mcp',
            name: 'GitHub MCP',
            summaryZh: '操作 GitHub 仓库',
            category: 'developer',
            tags: ['git', 'DevOps'],
            stats: { downloads: 1200, installs: 30 },
          },
        ],
      };

      const items = skillhubSource.parseRankings(body);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'skillhub_mcp:github-mcp',
        source: 'skillhub_mcp',
        name: 'GitHub MCP',
        description: '操作 GitHub 仓库',
        url: 'https://skillhub.cn/mcp/github-mcp',
        stats: '1200 downloads / 30 installs',
      });
      // category 与 tags 合并去重
      expect(items[0].tags).toEqual(['developer', 'git', 'devops']);
    });

    it('丢弃非法 slug（防注入）', () => {
      const body = {
        items: [
          { slug: '../evil', name: 'bad' },
          { slug: 'ok-slug', name: 'good' },
        ],
      };

      const items = skillhubSource.parseRankings(body);
      expect(items.map((i) => i.name)).toEqual(['good']);
    });

    it('缺字段时用兜底文案而不是崩', () => {
      const items = skillhubSource.parseRankings({ items: [{ slug: 'x1' }] });
      expect(items[0].name).toBe('x1');
      expect(items[0].description).toBeTruthy();
    });

    it('结构不符时返回空数组', () => {
      expect(skillhubSource.parseRankings({})).toEqual([]);
      expect(skillhubSource.parseRankings(null)).toEqual([]);
      expect(skillhubSource.parseRankings({ items: 'nope' })).toEqual([]);
    });

    it('详情 URL 指向 readme 接口', () => {
      expect(skillhubSource.detailUrl('skillhub_mcp:github-mcp')).toBe(
        'https://api.skillhub.cn/api/v1/mcp/servers/github-mcp/readme',
      );
    });
  });

  describe('mcpworld', () => {
    it('解析真实结构 { data: { mcpList: [ { servers: [...] } ] } }', () => {
      const body = {
        code: 0,
        data: {
          mcpList: [
            {
              query: 'most_popular',
              total: 259,
              servers: [
                {
                  id: '20ef2b339076e8eeb57138fa23d15dcb',
                  serverName: '网页内容抓取服务器',
                  description: '抓取网页并转 markdown',
                  star: 68302,
                  labels: ['本地部署', '网页抓取'],
                },
              ],
            },
          ],
        },
      };

      const items = mcpworldSource.parseRankings(body);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'mcpworld:20ef2b339076e8eeb57138fa23d15dcb',
        source: 'mcpworld',
        name: '网页内容抓取服务器',
        stats: '68302 stars',
        url: 'https://www.mcpworld.com/zh/detail/20ef2b339076e8eeb57138fa23d15dcb',
      });
      expect(items[0].tags).toEqual(['本地部署', '网页抓取']);
    });

    it('解析 { data: [...] } 包裹（历史形态）', () => {
      const body = {
        data: [
          {
            id: 'be0640da63865',
            name: 'Prometheus 指标查询',
            description: '查询 PromQL',
            tags: ['prometheus', 'devops'],
            stars: 521,
          },
        ],
      };

      const items = mcpworldSource.parseRankings(body);
      expect(items[0]).toMatchObject({
        id: 'mcpworld:be0640da63865',
        source: 'mcpworld',
        name: 'Prometheus 指标查询',
        stats: '521 stars',
        url: 'https://www.mcpworld.com/zh/detail/be0640da63865',
      });
    });

    it('解析 { data: { list: [...] } } 包裹', () => {
      const body = { data: { list: [{ id: 'abcdefgh1234', name: 'X' }] } };
      expect(mcpworldSource.parseRankings(body)).toHaveLength(1);
    });

    it('丢弃非法 id', () => {
      const body = { data: [{ id: '短', name: 'bad' }, { id: 'valid12345678', name: 'ok' }] };
      expect(mcpworldSource.parseRankings(body).map((i) => i.name)).toEqual(['ok']);
    });

    it('详情 URL 指向 detail 接口', () => {
      expect(mcpworldSource.detailUrl('mcpworld:be0640da63865')).toBe(
        'https://www.mcpworld.com/api/mcp-market/server/detail?id=be0640da63865&lg=zh',
      );
    });

    it('detail 的 abstract 数组拼成 markdown', () => {
      const body = {
        data: {
          detail: {
            abstract: [{ value: '# 标题' }, { value: '```json\n{"a":1}\n```' }],
          },
        },
      };

      const md = mcpworldDetailToMarkdown(body);
      expect(md).toContain('# 标题');
      expect(md).toContain('"a":1');
    });

    it('detail 缺 abstract 时回退 readme 字段', () => {
      const body = { data: { detail: { readme: '正文内容' } } };
      expect(mcpworldDetailToMarkdown(body)).toBe('正文内容');
    });

    it('detail 结构异常时返回空串而不是崩', () => {
      expect(mcpworldDetailToMarkdown(null)).toBe('');
      expect(mcpworldDetailToMarkdown({})).toBe('');
    });
  });

  describe('findSource', () => {
    it('按 id 找源', () => {
      expect(findSource('mcpworld')!.label).toBe('MCP World');
      expect(findSource('skillhub_mcp')!.label).toBe('SkillHub MCP');
      expect(findSource('nope')).toBeUndefined();
    });
  });
});
