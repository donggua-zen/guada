import { describe, expect, it } from 'vitest'

import {
  baseNameOf,
  extensionOf,
  fileUrlToPath,
  isAbsoluteLocalPath,
  isPathInside,
  toSessionAttachmentStoragePath,
  toWorkspaceRelative,
} from './localPath'

/**
 * file:// 链接 → 本地路径的解析与工作区归属判定。
 *
 * 这些分支覆盖的都是「模型在 markdown 里写出来的真实形态」：
 * 标准三斜杠、少一条斜杠、盘符被当成 authority、UNC、POSIX、
 * 以及带转义字符（中文 / 空格 / %20）和 #L42 行号片段。
 */

describe('fileUrlToPath — Windows 形态', () => {
  const win = true

  it('标准三斜杠盘符路径去掉前导斜杠', () => {
    expect(fileUrlToPath('file:///C:/ws/a.ts', win)).toBe('C:/ws/a.ts')
    expect(fileUrlToPath('file:///d:/AI/ai_chat/README.md', win)).toBe('d:/AI/ai_chat/README.md')
  })

  it('盘符被当成 authority 的写法（file://C:/a）同样可用', () => {
    expect(fileUrlToPath('file://C:/ws/a.ts', win)).toBe('C:/ws/a.ts')
  })

  it('单斜杠与无斜杠形态', () => {
    expect(fileUrlToPath('file:/C:/ws/a.ts', win)).toBe('C:/ws/a.ts')
    expect(fileUrlToPath('file:C:/ws/a.ts', win)).toBe('C:/ws/a.ts')
  })

  it('反斜杠路径归一为正斜杠', () => {
    expect(fileUrlToPath('file:///C:\\ws\\a.ts', win)).toBe('C:/ws/a.ts')
  })

  it('UNC 共享还原成 \\\\server\\share 形式', () => {
    expect(fileUrlToPath('file://server/share/a.ts', win)).toBe('\\\\server\\share\\a.ts')
  })

  it('localhost 视为本机而不是 UNC 主机', () => {
    expect(fileUrlToPath('file://localhost/C:/ws/a.ts', win)).toBe('C:/ws/a.ts')
  })
})

describe('fileUrlToPath — POSIX 形态', () => {
  const posix = false

  it('保留前导斜杠', () => {
    expect(fileUrlToPath('file:///home/u/a.ts', posix)).toBe('/home/u/a.ts')
    expect(fileUrlToPath('file:/home/u/a.ts', posix)).toBe('/home/u/a.ts')
  })

  it('Windows 风格不裁剪（非 Windows 平台不做盘符特判）', () => {
    expect(fileUrlToPath('file:///C:/ws/a.ts', posix)).toBe('/C:/ws/a.ts')
  })
})

describe('fileUrlToPath — 片段与转义', () => {
  it('忽略 #L42 行号片段与查询串', () => {
    expect(fileUrlToPath('file:///C:/ws/a.ts#L42', true)).toBe('C:/ws/a.ts')
    expect(fileUrlToPath('file:///C:/ws/a.ts#L42-L50', true)).toBe('C:/ws/a.ts')
    expect(fileUrlToPath('file:///C:/ws/a.ts?x=1', true)).toBe('C:/ws/a.ts')
  })

  it('还原中文与空格（%20）转义', () => {
    expect(fileUrlToPath('file:///C:/ws/%E6%8A%A5%E5%91%8A%201.md', true)).toBe('C:/ws/报告 1.md')
  })

  it('非法转义序列原样保留，不抛异常', () => {
    expect(fileUrlToPath('file:///C:/ws/100%/a.ts', true)).toBe('C:/ws/100%/a.ts')
  })

  it('大小写不敏感地识别协议', () => {
    expect(fileUrlToPath('FILE:///C:/ws/a.ts', true)).toBe('C:/ws/a.ts')
  })

  it('非 file 协议 / 空串返回 null', () => {
    expect(fileUrlToPath('https://example.com/a.ts')).toBeNull()
    expect(fileUrlToPath('vscode://file/C:/a.ts')).toBeNull()
    expect(fileUrlToPath('')).toBeNull()
    expect(fileUrlToPath('   ')).toBeNull()
  })
})

describe('isPathInside', () => {
  const win = true

  it('子路径在自己内部（含自身）', () => {
    expect(isPathInside('C:/ws/a.ts', 'C:/ws', win)).toBe(true)
    expect(isPathInside('C:/ws', 'C:/ws', win)).toBe(true)
    expect(isPathInside('C:/ws/sub/a.ts', 'C:/ws', win)).toBe(true)
  })

  it('Windows 下大小写与分隔符不敏感', () => {
    expect(isPathInside('c:/WS/a.ts', 'C:/ws', win)).toBe(true)
    expect(isPathInside('C:\\ws\\a.ts', 'C:/ws', win)).toBe(true)
  })

  it('前缀相同的兄弟目录不算在内', () => {
    expect(isPathInside('C:/ws-other/a.ts', 'C:/ws', win)).toBe(false)
    expect(isPathInside('/a/bc/d', '/a/b', false)).toBe(false)
  })

  it('工作区根带尾斜杠也能正确判定', () => {
    expect(isPathInside('C:/ws/a.ts', 'C:/ws/', win)).toBe(true)
  })

  it('POSIX 下大小写敏感', () => {
    expect(isPathInside('/ws/a.ts', '/WS', false)).toBe(false)
  })

  it('空参数返回 false', () => {
    expect(isPathInside('', 'C:/ws', win)).toBe(false)
    expect(isPathInside('C:/ws/a.ts', '', win)).toBe(false)
  })
})

describe('toWorkspaceRelative', () => {
  const win = true

  it('工作区内 → 相对路径（正斜杠、保留原始大小写）', () => {
    expect(toWorkspaceRelative('C:/ws/sub/A.ts', 'C:/ws', win)).toBe('sub/A.ts')
    expect(toWorkspaceRelative('D:/AI/ai_chat/src/index.ts', 'D:/AI/ai_chat', win)).toBe('src/index.ts')
  })

  it('盘符大小写不同也能切出正确相对路径', () => {
    expect(toWorkspaceRelative('D:/Ws/a.ts', 'd:/ws', win)).toBe('a.ts')
  })

  it('工作区根自身 → 空串', () => {
    expect(toWorkspaceRelative('C:/ws', 'C:/ws', win)).toBe('')
  })

  it('工作区外 → null', () => {
    expect(toWorkspaceRelative('C:/other/a.ts', 'C:/ws', win)).toBeNull()
    expect(toWorkspaceRelative('/home/u/a.ts', '/home/other', false)).toBeNull()
  })
})

describe('isAbsoluteLocalPath', () => {
  it('Windows 盘符 / UNC 视为绝对路径', () => {
    expect(isAbsoluteLocalPath('C:/ws/a.ts', true)).toBe(true)
    expect(isAbsoluteLocalPath('C:\\ws\\a.ts', true)).toBe(true)
    expect(isAbsoluteLocalPath('D:', true)).toBe(true)
    expect(isAbsoluteLocalPath('\\\\server\\share\\a.ts', true)).toBe(true)
    expect(isAbsoluteLocalPath('//server/share/a.ts', true)).toBe(true)
  })

  it('工作区相对路径不算绝对路径', () => {
    expect(isAbsoluteLocalPath('src/index.ts', true)).toBe(false)
    expect(isAbsoluteLocalPath('./src/index.ts', true)).toBe(false)
    expect(isAbsoluteLocalPath('../a.ts', true)).toBe(false)
    expect(isAbsoluteLocalPath('', true)).toBe(false)
  })

  it('Windows 下前导斜杠是驱动器相对路径，不算绝对路径；POSIX 下算', () => {
    expect(isAbsoluteLocalPath('/ws/a.ts', true)).toBe(false)
    expect(isAbsoluteLocalPath('/home/u/a.ts', false)).toBe(true)
  })
})

describe('toSessionAttachmentStoragePath', () => {
  const sid = 'session-3703d705-72fc-4ed2-9c65-bc85d5f31c47'

  it('本会话附件绝对路径 → 自包含存储引用（正/反斜杠都吃）', () => {
    expect(
      toSessionAttachmentStoragePath(
        `C:\\Users\\u\\.guada\\sessions\\${sid}\\images\\20261121\\image_1.jpg`,
        sid,
        true,
      ),
    ).toBe(`sessions/${sid}/images/20261121/image_1.jpg`)
    expect(
      toSessionAttachmentStoragePath(
        `/home/u/.guada/sessions/${sid}/previews/20261121/a.png`,
        sid,
        false,
      ),
    ).toBe(`sessions/${sid}/previews/20261121/a.png`)
  })

  it('Windows 下盘符/目录大小写不同仍能命中，返回保留原始大小写', () => {
    expect(
      toSessionAttachmentStoragePath(
        `c:\\users\\u\\.guada\\SESSIONS\\${sid}\\images\\A.JPG`,
        sid,
        true,
      ),
    ).toBe(`sessions/${sid}/images/A.JPG`)
  })

  it('其他会话 / 工作区普通文件 → null', () => {
    expect(
      toSessionAttachmentStoragePath(`C:/data/sessions/other-session/images/a.jpg`, sid, true),
    ).toBeNull()
    expect(toSessionAttachmentStoragePath(`C:/ws/sessions/${sid}/images/a.jpg`, sid, true)).toBe(
      `sessions/${sid}/images/a.jpg`,
    )
    expect(toSessionAttachmentStoragePath(`C:/ws/src/a.ts`, sid, true)).toBeNull()
  })

  it('路径穿越 / 盘符段 → null', () => {
    expect(
      toSessionAttachmentStoragePath(`C:/x/sessions/${sid}/images/../../secret.key`, sid, true),
    ).toBeNull()
    expect(
      toSessionAttachmentStoragePath(`C:/x/sessions/${sid}/images//a.jpg`, sid, true),
    ).toBeNull()
    expect(
      toSessionAttachmentStoragePath(`C:/x/sessions/${sid}/C:/windows/a.jpg`, sid, true),
    ).toBeNull()
  })

  it('空参数 / 缺少相对段 → null', () => {
    expect(toSessionAttachmentStoragePath('', sid, true)).toBeNull()
    expect(toSessionAttachmentStoragePath(`C:/x/sessions/${sid}`, sid, true)).toBeNull()
    expect(toSessionAttachmentStoragePath(`C:/x/sessions/${sid}/`, sid, true)).toBeNull()
  })
})

describe('baseNameOf / extensionOf', () => {
  it('取末段文件名，两种分隔符都吃', () => {
    expect(baseNameOf('C:/ws/a.ts')).toBe('a.ts')
    expect(baseNameOf('C:\\ws\\a.ts')).toBe('a.ts')
    expect(baseNameOf('C:/ws/')).toBe('ws')
    expect(baseNameOf('a.ts')).toBe('a.ts')
    expect(baseNameOf('')).toBe('')
  })

  it('扩展名小写且含点；隐藏文件名不作为扩展名', () => {
    expect(extensionOf('A.TS')).toBe('.ts')
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('.gitignore')).toBe('')
  })
})
