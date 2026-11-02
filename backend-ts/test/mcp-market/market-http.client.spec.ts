import {
  ALLOWED_MARKET_HOSTS,
  SKILLHUB_DOWNLOAD_HOST_POLICY,
  isAllowedMarketUrl,
} from "../../src/common/http/market-http.client";

/**
 * 市场 HTTP 白名单测试。
 *
 * 这层是 SSRF 的唯一防线：市场 URL 有一部分来自第三方返回的数据
 * （readme 里的链接、重定向 Location），等价于「让远端决定我们请求哪里」。
 * 因此每条拒绝路径都要有测试锁住，避免将来被"顺手放宽"。
 */
describe('market-http.client 白名单', () => {
  it('允许白名单内的 https 地址', () => {
    expect(isAllowedMarketUrl('https://api.skillhub.cn/api/v1/mcp/servers')).toBe(true);
    expect(isAllowedMarketUrl('https://skillhub.cn/mcp/demo')).toBe(true);
    expect(isAllowedMarketUrl('https://www.mcpworld.com/api/mcp-market/servers')).toBe(true);
  });

  it('显式 443 端口也允许', () => {
    expect(isAllowedMarketUrl('https://api.skillhub.cn:443/x')).toBe(true);
  });

  it('拒绝非白名单主机', () => {
    expect(isAllowedMarketUrl('https://evil.com/x')).toBe(false);
    expect(isAllowedMarketUrl('https://skillhub.cn.evil.com/x')).toBe(false);
  });

  it('拒绝子域（白名单是精确匹配，不做通配）', () => {
    expect(isAllowedMarketUrl('https://foo.skillhub.cn/x')).toBe(false);
  });

  it('拒绝 http 降级', () => {
    expect(isAllowedMarketUrl('http://api.skillhub.cn/x')).toBe(false);
  });

  it('拒绝非 443 端口（可能是内网映射）', () => {
    expect(isAllowedMarketUrl('https://api.skillhub.cn:8080/x')).toBe(false);
    expect(isAllowedMarketUrl('https://api.skillhub.cn:8443/x')).toBe(false);
  });

  it('拒绝带 userinfo 的地址（主机判断歧义）', () => {
    expect(isAllowedMarketUrl('https://user:pass@api.skillhub.cn/x')).toBe(false);
    expect(isAllowedMarketUrl('https://evil.com@api.skillhub.cn/x')).toBe(false);
  });

  it('拒绝内网 / 回环 / 云元数据地址', () => {
    expect(isAllowedMarketUrl('http://127.0.0.1:3000/x')).toBe(false);
    expect(isAllowedMarketUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowedMarketUrl('https://10.0.0.1/x')).toBe(false);
    expect(isAllowedMarketUrl('https://localhost/x')).toBe(false);
  });

  it('拒绝非 http(s) 协议', () => {
    expect(isAllowedMarketUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedMarketUrl('ftp://api.skillhub.cn/x')).toBe(false);
  });

  it('拒绝非法 URL', () => {
    expect(isAllowedMarketUrl('')).toBe(false);
    expect(isAllowedMarketUrl('not a url')).toBe(false);
  });

  it('允许 SkillHub 的 COS 桶（readme 会 302 到这里）', () => {
    expect(
      isAllowedMarketUrl(
        'https://skillhub-1388575217.cos.accelerate.myqcloud.com/mcp/demo/README.md',
      ),
    ).toBe(true);
  });

  it('拒绝其它 COS 桶（不放开整个 myqcloud.com 域）', () => {
    expect(
      isAllowedMarketUrl('https://other-bucket.cos.accelerate.myqcloud.com/x'),
    ).toBe(false);
    expect(isAllowedMarketUrl('https://cos.ap-guangzhou.myqcloud.com/x')).toBe(false);
  });

  it('白名单是显式枚举，改动必须是有意识的', () => {
    expect([...ALLOWED_MARKET_HOSTS]).toEqual([
      'api.skillhub.cn',
      'skillhub.cn',
      'www.mcpworld.com',
      'skillhub-1388575217.cos.accelerate.myqcloud.com',
    ]);
  });

  it('SkillHub 下载策略只放开 api 与 skillhub-* COS 桶', () => {
    expect(
      isAllowedMarketUrl(
        'https://api.skillhub.cn/api/v1/download?slug=demo',
        SKILLHUB_DOWNLOAD_HOST_POLICY,
      ),
    ).toBe(true);
    expect(
      isAllowedMarketUrl(
        'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/skills/demo.zip',
        SKILLHUB_DOWNLOAD_HOST_POLICY,
      ),
    ).toBe(true);
    expect(
      isAllowedMarketUrl(
        'https://skillhub-1388575217.cos.accelerate.myqcloud.com/skills/demo.zip',
        SKILLHUB_DOWNLOAD_HOST_POLICY,
      ),
    ).toBe(true);

    // 其它桶、无 skillhub 前缀的桶、站点域名都不放行
    expect(
      isAllowedMarketUrl(
        'https://other-bucket.cos.ap-guangzhou.myqcloud.com/skills/demo.zip',
        SKILLHUB_DOWNLOAD_HOST_POLICY,
      ),
    ).toBe(false);
    expect(
      isAllowedMarketUrl('https://skillhub.cn/skills/demo', SKILLHUB_DOWNLOAD_HOST_POLICY),
    ).toBe(false);
    expect(
      isAllowedMarketUrl(
        'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com.evil.com/x.zip',
        SKILLHUB_DOWNLOAD_HOST_POLICY,
      ),
    ).toBe(false);
  });
});
