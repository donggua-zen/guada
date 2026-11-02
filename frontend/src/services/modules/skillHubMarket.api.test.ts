import { describe, it, expect, vi } from 'vitest'
import type { ApiContext } from './api-context'
import { skillHubMarketApi } from './skillHubMarket.api'

function makeContext() {
  const request = vi.fn().mockResolvedValue({})
  return { ctx: { _request: request } as unknown as ApiContext, request }
}

describe('skillHubMarketApi', () => {
  it('列表请求携带分页/关键词/分类/语言', async () => {
    const { ctx, request } = makeContext()

    await skillHubMarketApi.fetchSkillHubList.call(ctx, {
      page: 2,
      pageSize: 12,
      keyword: 'pdf 提取',
      category: 'office-efficiency',
      lang: 'zh',
    })

    const url = request.mock.calls[0][0] as string
    const parsed = new URL(url, 'http://localhost')

    expect(parsed.pathname).toBe('/skill-market/skillhub/list')
    expect(parsed.searchParams.get('page')).toBe('2')
    expect(parsed.searchParams.get('pageSize')).toBe('12')
    expect(parsed.searchParams.get('keyword')).toBe('pdf 提取')
    expect(parsed.searchParams.get('category')).toBe('office-efficiency')
    expect(parsed.searchParams.get('lang')).toBe('zh')
  })

  it('推荐请求按 refresh 追加 refresh=1', async () => {
    const { ctx, request } = makeContext()

    await skillHubMarketApi.fetchSkillHubRecommended.call(ctx, 12, true, 'en')
    await skillHubMarketApi.fetchSkillHubRecommended.call(ctx, 12, false, 'en')

    expect(request.mock.calls[0][0]).toContain('/skill-market/skillhub/recommended?limit=12&lang=en&refresh=1')
    expect(request.mock.calls[1][0]).not.toContain('refresh=1')
  })

  it('详情请求对 slug 做编码', async () => {
    const { ctx, request } = makeContext()

    await skillHubMarketApi.fetchSkillHubDetail.call(ctx, 'a b/c', 'zh')

    expect(request.mock.calls[0][0]).toBe(
      '/skill-market/skillhub/skills/a%20b%2Fc?lang=zh',
    )
  })

  it('安装在 body 里传 slug/version/force，并放宽超时', async () => {
    const { ctx, request } = makeContext()

    await skillHubMarketApi.installSkillHubSkill.call(ctx, {
      slug: 'demo-skill',
      version: '1.2.3',
      force: true,
    })

    expect(request).toHaveBeenCalledWith('/skill-market/skillhub/install', {
      method: 'POST',
      data: { slug: 'demo-skill', version: '1.2.3', force: true },
      timeout: 180000,
    })
  })
})
