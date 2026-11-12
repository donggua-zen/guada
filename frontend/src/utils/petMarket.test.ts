import { describe, expect, it } from 'vitest'
import { normalizeMarketIndex } from './petMarket'

/**
 * 索引是**远端不可信输入**：结构不对、slug 非法、链接不是 https 都要挡住，
 * 否则会把恶意 URL 塞进 <img>，或者一份坏索引让市场页崩掉。
 */
describe('normalizeMarketIndex', () => {
  it('正常索引：字段齐全', () => {
    const index = normalizeMarketIndex({
      version: 1,
      source: 'petdex',
      sourceName: 'Petdex',
      homepage: 'https://petdex.dev',
      attribution: '版权归原作者',
      generatedAt: '2026-11-12T00:00:00.000Z',
      featured: ['boba'],
      pets: [
        {
          slug: 'boba',
          name: 'Boba',
          author: 'Railly',
          page: 'https://petdex.dev/pets/boba',
          preview: 'https://petdex.dev/pets/boba/opengraph-image',
          thumb: '/petdex/thumbs/boba.webp',
          sprite: 'https://assets.petdex.dev/curated/boba/sprite-v2.webp',
          rows: 11,
          description: 'otter',
          genre: 'creature',
          keywords: ['otter', 'cozy'],
          publishedAt: '2026-05-02',
        },
      ],
    })

    expect(index).not.toBeNull()
    expect(index!.count).toBe(1)
    expect(index!.featured).toEqual(['boba'])
    const pet = index!.pets[0]
    expect(pet.slug).toBe('boba')
    // 相对路径补成绝对 URL
    expect(pet.thumb).toBe('https://ai.dingd.cn/petdex/thumbs/boba.webp')
    expect(pet.rows).toBe(11)
    expect(pet.description).toBe('otter')
  })

  it('缺字段时补默认值', () => {
    const index = normalizeMarketIndex({ pets: [{ slug: 'x1' }] })
    expect(index).not.toBeNull()
    const pet = index!.pets[0]
    expect(pet.name).toBe('x1')
    expect(pet.author).toBe('')
    expect(pet.page).toBe('https://petdex.dev/pets/x1')
    expect(pet.preview).toBe('https://petdex.dev/pets/x1/opengraph-image')
    expect(index!.sourceName).toBe('Petdex')
    expect(index!.featured).toEqual([])
  })

  it('非法 slug 剔除；非 https 链接回落官方地址', () => {
    const index = normalizeMarketIndex({
      pets: [
        { slug: '../../etc/passwd', name: 'bad' },
        { slug: 'a b', name: 'bad2' },
        {
          slug: 'ok-1',
          name: 'ok',
          page: 'javascript:alert(1)',
          preview: 'file:///etc/x.png',
          sprite: 'http://insecure/x.webp',
        },
      ],
    })
    expect(index).not.toBeNull()
    expect(index!.pets).toHaveLength(1)
    const pet = index!.pets[0]
    expect(pet.slug).toBe('ok-1')
    expect(pet.page.startsWith('https://petdex.dev/')).toBe(true)
    expect(pet.preview.startsWith('https://petdex.dev/')).toBe(true)
    expect(pet.sprite).toBeUndefined()
  })

  it('rows 只认 9 / 11', () => {
    const index = normalizeMarketIndex({
      pets: [
        { slug: 'a', rows: 9 },
        { slug: 'b', rows: 11 },
        { slug: 'c', rows: 10 },
        { slug: 'd', rows: '9' },
      ],
    })
    expect(index!.pets.map((p) => p.rows)).toEqual([9, 11, undefined, undefined])
  })

  it('featured 只保留索引里真实存在的 slug', () => {
    const index = normalizeMarketIndex({
      featured: ['a', 'ghost', 'b'],
      pets: [{ slug: 'a' }, { slug: 'b' }],
    })
    expect(index!.featured).toEqual(['a', 'b'])
  })

  it('整体结构不对 → null（调用方按「市场不可用」处理）', () => {
    expect(normalizeMarketIndex(null)).toBeNull()
    expect(normalizeMarketIndex([])).toBeNull()
    expect(normalizeMarketIndex({})).toBeNull()
    expect(normalizeMarketIndex({ pets: [] })).toBeNull()
    expect(normalizeMarketIndex({ pets: 'nope' })).toBeNull()
    // 全是垃圾 → null
    expect(normalizeMarketIndex({ pets: [{ slug: '!!' }] })).toBeNull()
  })

  it('描述超长会截断（索引要发给每个客户端）', () => {
    const index = normalizeMarketIndex({
      pets: [{ slug: 'a', description: 'x'.repeat(500) }],
    })
    expect(index!.pets[0].description!.length).toBe(300)
  })
})
