/// <reference types="jest" />

import { buildBrowseCommand, parseBrowseOutput } from '../../src/modules/remote-workspace/remote-workspace.service';

describe('parseBrowseOutput（远端目录浏览输出解析）', () => {
  it('解析路径、存在性与条目，目录优先再按名称排序', () => {
    const raw = [
      'GUADA_PATH:/home/foo',
      'GUADA_EXISTS',
      'readme.md/0/1234',
      'zdir/1/4096',
      'adir/1/40',
    ].join('\n');

    expect(parseBrowseOutput(raw)).toEqual({
      path: '/home/foo',
      exists: true,
      entries: [
        { name: 'adir', isDirectory: true, size: 40 },
        { name: 'zdir', isDirectory: true, size: 4096 },
        { name: 'readme.md', isDirectory: false, size: 1234 },
      ],
    });
  });

  it('目录不存在时 exists 为 false 且无条目', () => {
    const raw = ['GUADA_PATH:/home/topeet/RK1820_RK1828_SDK', 'GUADA_MISSING'].join('\n');

    expect(parseBrowseOutput(raw)).toEqual({
      path: '/home/topeet/RK1820_RK1828_SDK',
      exists: false,
      entries: [],
    });
  });

  it('空输出不抛错', () => {
    expect(parseBrowseOutput('')).toEqual({ path: '', exists: false, entries: [] });
  });

  it('过滤 . 与 .. 行，忽略空行与残缺行', () => {
    const raw = [
      'GUADA_PATH:/root',
      'GUADA_EXISTS',
      './1/4096',
      '../1/4096',
      '',
      'garbage',
      'a/1/7',
    ].join('\n');

    expect(parseBrowseOutput(raw).entries).toEqual([{ name: 'a', isDirectory: true, size: 7 }]);
  });

  it('目录内存在名为 GUADA_EXISTS 的文件不会被误判为标记行', () => {
    const raw = ['GUADA_PATH:/tmp', 'GUADA_EXISTS', 'GUADA_EXISTS/0/12'].join('\n');
    const result = parseBrowseOutput(raw);

    expect(result.exists).toBe(true);
    expect(result.entries).toEqual([{ name: 'GUADA_EXISTS', isDirectory: false, size: 12 }]);
  });

  it('后续标记行可覆盖存在性（同一输出里最后出现的标记生效）', () => {
    const raw = ['GUADA_PATH:/tmp', 'GUADA_MISSING', 'GUADA_EXISTS', 'a/1/1'].join('\n');

    expect(parseBrowseOutput(raw).exists).toBe(true);
  });
});

describe('buildBrowseCommand（远端浏览命令构造）', () => {
  it('空路径由远端回退到 $HOME', () => {
    const cmd = buildBrowseCommand('');

    expect(cmd).toContain(`d=''`);
    expect(cmd).toContain('d="$HOME"');
    expect(cmd).toContain('echo "GUADA_PATH:$d"');
  });

  it('$HOME 不存在时依次回退到登录目录与 /（NAS 账号 $HOME 可能指向不存在的目录）', () => {
    const cmd = buildBrowseCommand('');

    expect(cmd).toContain('[ -d "$d" ] || d="$PWD"');
    expect(cmd).toContain('[ -d "$d" ] || d=/');
  });

  it('路径用单引号包裹并转义内嵌单引号，避免远端展开 $ 与反引号', () => {
    const dirPath = "/home/a b/it's";
    const cmd = buildBrowseCommand(dirPath);

    expect(cmd).toContain(`d='/home/a b/it'\\''s'`);
    // 旧实现用双引号插值，路径里的 $ 会被远端 shell 展开
    expect(cmd.includes(`"${dirPath}"`)).toBe(false);
  });

  it('存在性分支与 ls 输出格式稳定（不依赖 GNU 专属参数）', () => {
    const cmd = buildBrowseCommand('/data/proj');

    expect(cmd).toContain('if [ -d "$d" ]; then echo GUADA_EXISTS;');
    expect(cmd).toContain('else echo GUADA_MISSING; fi');
    expect(cmd).toContain(`awk 'NR>1 {print $NF "/" ($1 ~ /^d/ ? "1" : "0") "/" $5}'`);
    expect(cmd).not.toContain('--time-style');
  });
});
