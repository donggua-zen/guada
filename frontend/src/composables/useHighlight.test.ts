import { describe, it, expect } from 'vitest'

import { getPreviewKind, isUnplayableMediaFile } from './useHighlight'

describe('getPreviewKind（预览面板的唯一分流入口）', () => {
  it('代码/文本/配置类 → text', () => {
    for (const ext of ['.ts', '.py', '.md', '.markdown', '.json', '.yaml', '.log', '.csv', '.toml', '.env']) {
      expect(getPreviewKind(ext), ext).toBe('text')
    }
  })

  it('.ts 是 TypeScript 而不是 MPEG-TS（回归：别被视频表抢走）', () => {
    expect(getPreviewKind('.ts')).toBe('text')
    expect(getPreviewKind('.tsx')).toBe('text')
  })

  it('.svg 归 text（渲染成图片由面板按 isSvgFile 另判，源码仍可编辑）', () => {
    expect(getPreviewKind('.svg')).toBe('text')
  })

  it('位图 → image', () => {
    for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.tiff', '.tif', '.heic', '.heif', '.jfif']) {
      expect(getPreviewKind(ext), ext).toBe('image')
    }
  })

  it('音频 → audio', () => {
    for (const ext of ['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.weba']) {
      expect(getPreviewKind(ext), ext).toBe('audio')
    }
  })

  it('视频 → video', () => {
    for (const ext of ['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv']) {
      expect(getPreviewKind(ext), ext).toBe('video')
    }
  })

  it('pdf → pdf', () => {
    expect(getPreviewKind('.pdf')).toBe('pdf')
  })

  it('大小写不敏感', () => {
    expect(getPreviewKind('.PNG')).toBe('image')
    expect(getPreviewKind('.MP4')).toBe('video')
    expect(getPreviewKind('.PDF')).toBe('pdf')
  })

  it('未知/空扩展名 → unsupported', () => {
    for (const ext of ['', '.zip', '.exe', '.docx', '.bin', '.psd']) {
      expect(getPreviewKind(ext), ext).toBe('unsupported')
    }
  })
})

describe('isUnplayableMediaFile（已知但浏览器解不了的容器）', () => {
  it('老式/封闭容器 → true', () => {
    for (const ext of ['.avi', '.flv', '.wmv', '.wma', '.mpg', '.mpeg', '.rmvb', '.3gp']) {
      expect(isUnplayableMediaFile(ext), ext).toBe(true)
    }
    expect(isUnplayableMediaFile('.AVI')).toBe(true)
  })

  it('可播格式与 .ts（TypeScript）→ false', () => {
    for (const ext of ['.mp4', '.webm', '.mkv', '.mp3', '.ts', '.png', '']) {
      expect(isUnplayableMediaFile(ext), ext).toBe(false)
    }
  })
})
