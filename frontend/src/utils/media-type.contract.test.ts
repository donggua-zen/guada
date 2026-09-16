/**
 * 前后端扩展名分类表的镜像契约测试。
 *
 * 本文件与 backend-ts/src/common/utils/media-type.util.ts 是刻意的手工镜像
 * （两个构建根，暂无法共享包），此测试直接读取后端源文件逐项比对，
 * 任何一侧漂移（新增扩展名、改 MIME、改位图白名单）都会在此失败。
 */

/// <reference types="node" />

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

import {
  EXT_TO_MIME,
  RASTER_IMAGE_EXTENSIONS,
  VISION_IMAGE_MIME_TYPES,
  normalizeMediaType,
} from './media-type'

const BACKEND_UTIL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../backend-ts/src/common/utils/media-type.util.ts',
)

const backendSource = fs.readFileSync(BACKEND_UTIL, 'utf-8')

/** 从后端源码里抠出一个 `const NAME = [ ... ] as const;` 数组的字面量项 */
function parseBackendArray(name: string): string[] {
  const block = backendSource.match(
    new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`),
  )?.[1]
  if (block === undefined) throw new Error(`未能在后端源码中定位 ${name}`)
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** 从后端源码里抠出 EXT_TO_MIME 对象的键值对 */
function parseBackendExtToMime(): Array<[string, string]> {
  const block = backendSource.match(
    /const EXT_TO_MIME: Record<string, string> = \{([\s\S]*?)\n\};/,
  )?.[1]
  if (block === undefined) throw new Error('未能在后端源码中定位 EXT_TO_MIME')
  return [...block.matchAll(/^\s*'?([\w-]+)'?:\s*'([^']+)',/gm)].map((m) => [
    m[1],
    m[2],
  ])
}

describe('media-type 镜像契约', () => {
  it('EXT_TO_MIME 键集合与后端完全一致', () => {
    const backendKeys = parseBackendExtToMime()
      .map(([k]) => k)
      .sort()
    expect(Object.keys(EXT_TO_MIME).sort()).toEqual(backendKeys)
  })

  it('EXT_TO_MIME 每一项的 MIME 与后端一致', () => {
    for (const [ext, mime] of parseBackendExtToMime()) {
      expect(normalizeMediaType(null, ext), `扩展名 ${ext}`).toBe(mime)
    }
  })

  it('RASTER_IMAGE_EXTENSIONS 与后端逐项一致', () => {
    expect([...RASTER_IMAGE_EXTENSIONS]).toEqual(parseBackendArray('RASTER_IMAGE_EXTENSIONS'))
  })

  it('VISION_IMAGE_MIME_TYPES 与后端逐项一致', () => {
    expect([...VISION_IMAGE_MIME_TYPES]).toEqual(
      parseBackendArray('VISION_IMAGE_MIME_TYPES'),
    )
  })

  it('后端源码确实存在（防止路径写错导致空比对通过）', () => {
    expect(backendSource).toContain('isVisionImageMediaType')
    expect(backendSource.length).toBeGreaterThan(1000)
  })
})
