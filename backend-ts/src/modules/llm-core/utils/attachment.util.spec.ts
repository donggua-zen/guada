import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  attachmentToPart,
  attachmentToDataUrl,
  fileBlockToText,
  resolveModelVisiblePath,
  resolvePhysicalPath,
} from './attachment.util';

describe('attachment.util', () => {
  let tmpDir: string;
  let sessionsBase: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-util-'));
    process.env.UPLOAD_ROOT_DIR = tmpDir;
    // SESSION_DATA_DIR 必须与 UPLOAD_ROOT_DIR 的父目录不同（生产布局即如此：
    // file_stores 与 sessions 是两个兄弟目录），否则 store 字符串形态会意外命中
    // session 目录，掩盖"字符串形态不识别 session"这一契约。
    process.env.SESSION_DATA_DIR = path.join(tmpDir, 'sessions-root');
    sessionsBase = path.join(tmpDir, 'sessions-root', 'sessions');
  });

  afterAll(async () => {
    delete process.env.UPLOAD_ROOT_DIR;
    delete process.env.SESSION_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('resolvePhysicalPath', () => {
    it('拼接 UPLOAD_ROOT_DIR 并剥掉 uploads/ 前缀', () => {
      const p = resolvePhysicalPath('uploads/images/a.png');
      expect(path.resolve(p)).toBe(path.join(path.resolve(tmpDir), 'images/a.png'));
    });

    it('完整 URL 取路径部分', () => {
      const p = resolvePhysicalPath('http://localhost:3000/uploads/images/b.jpg');
      expect(path.resolve(p)).toBe(path.join(path.resolve(tmpDir), 'images/b.jpg'));
    });
  });

  describe('attachmentToPart', () => {
    it('本地文件 → base64 形态（含缓存命中）', async () => {
      const dir = path.join(tmpDir, 'images');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, 't.png');
      const raw = Buffer.from('hello-image');
      await fs.writeFile(file, raw);

      const ref = 'uploads/images/t.png';
      const part = await attachmentToPart(ref);
      expect(part).toEqual({
        kind: 'base64',
        mimeType: 'image/png',
        base64: raw.toString('base64'),
      });

      // 修改文件 → mtime 变化 → 缓存失效
      const raw2 = Buffer.from('updated');
      await fs.writeFile(file, raw2);
      const part2 = await attachmentToPart(ref);
      expect(part2).toEqual({
        kind: 'base64',
        mimeType: 'image/png',
        base64: raw2.toString('base64'),
      });
    });

    it('mediaType 覆盖扩展名猜测', async () => {
      const file = path.join(tmpDir, 'noext');
      await fs.writeFile(file, 'x');
      const part = await attachmentToPart('noext', 'image/webp');
      expect(part).toMatchObject({ kind: 'base64', mimeType: 'image/webp' });
    });

    it('data URL → 解析为 { mimeType, base64 }', async () => {
      const part = await attachmentToPart('data:image/jpeg;base64,QUJD');
      expect(part).toEqual({ kind: 'base64', mimeType: 'image/jpeg', base64: 'QUJD' });
    });

    it('远程 URL → url 形态透传', async () => {
      const part = await attachmentToPart('https://example.com/a.png');
      expect(part).toEqual({ kind: 'url', url: 'https://example.com/a.png' });
    });

    it('文件不存在 → null', async () => {
      expect(await attachmentToPart('uploads/images/missing.png')).toBeNull();
    });

    it('空引用 → null', async () => {
      expect(await attachmentToPart('')).toBeNull();
    });
  });

  describe('attachmentToDataUrl（向后兼容）', () => {
    it('本地文件 → data URL', async () => {
      const file = path.join(tmpDir, 'd.png');
      const raw = Buffer.from('zzz');
      await fs.writeFile(file, raw);
      expect(await attachmentToDataUrl('d.png')).toBe(
        `data:image/png;base64,${raw.toString('base64')}`,
      );
    });

    it('远程 URL 原样透传', async () => {
      expect(await attachmentToDataUrl('https://example.com/x.png')).toBe(
        'https://example.com/x.png',
      );
    });
  });

  describe('resolveModelVisiblePath', () => {
    it('相对存储引用 → 绝对物理路径', () => {
      expect(resolveModelVisiblePath('uploads/images/a.png')).toBe(
        path.join(path.resolve(tmpDir), 'images/a.png'),
      );
    });

    it('本机上传 URL → 反解物理路径', () => {
      expect(resolveModelVisiblePath('http://localhost:3000/uploads/images/b.jpg')).toBe(
        path.join(path.resolve(tmpDir), 'images/b.jpg'),
      );
    });

    it('data: URL → null（无物理路径）', () => {
      expect(resolveModelVisiblePath('data:image/png;base64,QUJD')).toBeNull();
    });

    it('未配置 UPLOAD_ROOT_DIR → null（不给必错的路径）', () => {
      delete process.env.UPLOAD_ROOT_DIR;
      try {
        expect(resolveModelVisiblePath('uploads/images/a.png')).toBeNull();
      } finally {
        process.env.UPLOAD_ROOT_DIR = tmpDir;
      }
    });
  });

  describe('fileBlockToText', () => {
    it('store 引用桥接为绝对物理路径，并按扩展名给出工具指引', () => {
      expect(
        fileBlockToText({ name: 'a.pdf', url: 'uploads/files/a.pdf', attachmentId: 'f1' }),
      ).toBe(
        `[文件: a.pdf (${path.join(path.resolve(tmpDir), 'files/a.pdf')})]。` +
          '解析内容请调用 document.doc_parse（file_path 传上面的绝对路径）',
      );
    });

    it('文本类扩展名指向 read 工具', () => {
      const text = fileBlockToText({ name: 'a.log', url: 'uploads/files/a.log' });
      expect(text).toContain('读取内容请调用 read');
    });

    it('无法桥接时只给文件名（不编造路径、不当路径用 attachmentId）', () => {
      expect(fileBlockToText({ attachmentId: 'f2' })).toBe('[文件: f2]');
    });

    it("'workspace' 引用需要 ctx.workspaceDir 才能桥接", () => {
      const ref = { name: 'b.docx', url: 'uploads/20260915/b.docx', refType: 'workspace' as const };
      // 无上下文 → 只给文件名
      expect(fileBlockToText(ref)).toBe('[文件: b.docx]');
      // 有上下文 → 工作目录下桥接
      expect(fileBlockToText(ref, { workspaceDir: '/ws' })).toBe(
        `[文件: b.docx (${path.join(path.resolve('/ws'), 'uploads/20260915/b.docx')})]。` +
          '解析内容请调用 document.doc_parse（file_path 传上面的绝对路径）',
      );
    });

    it("'local' 引用（Electron 本机路径）原样桥接，不依赖 UPLOAD_ROOT_DIR", () => {
      delete process.env.UPLOAD_ROOT_DIR;
      try {
        const localPath = path.join(path.resolve('/'), 'somewhere', 'note.txt');
        expect(fileBlockToText({ name: 'note.txt', url: localPath, refType: 'local' })).toBe(
          `[文件: note.txt (${path.normalize(localPath)})]。读取内容请调用 read（file_path 传上面的绝对路径）`,
        );
      } finally {
        process.env.UPLOAD_ROOT_DIR = tmpDir;
      }
    });
  });

  describe('resolveModelVisiblePath（按 refType 分派）', () => {
    it("'store' 缺省语义不变（无 refType 的历史数据同样走 store）", () => {
      expect(resolveModelVisiblePath({ url: 'uploads/images/a.png' })).toBe(
        path.join(path.resolve(tmpDir), 'images/a.png'),
      );
      expect(resolveModelVisiblePath({ url: 'uploads/images/a.png', refType: 'store' })).toBe(
        path.join(path.resolve(tmpDir), 'images/a.png'),
      );
    });

    it("'workspace' 相对引用拼在工作目录下", () => {
      expect(
        resolveModelVisiblePath(
          { url: 'uploads/20260915/report.pdf', refType: 'workspace' },
          { workspaceDir: '/ws' },
        ),
      ).toBe(path.join(path.resolve('/ws'), 'uploads/20260915/report.pdf'));
    });

    it("'workspace' 缺 workspaceDir → null", () => {
      expect(
        resolveModelVisiblePath({ url: 'uploads/x.pdf', refType: 'workspace' }),
      ).toBeNull();
    });

    it("'workspace' 引用越出工作目录 → null（上跳不给路径）", () => {
      expect(
        resolveModelVisiblePath(
          { url: '../../etc/passwd', refType: 'workspace' },
          { workspaceDir: '/ws/nested' },
        ),
      ).toBeNull();
    });

    it("'local' 绝对路径原样返回，且不受 UPLOAD_ROOT_DIR 配置影响", () => {
      delete process.env.UPLOAD_ROOT_DIR;
      try {
        const abs = path.join(path.resolve('/'), 'data', 'a.xlsx');
        expect(resolveModelVisiblePath({ url: abs, refType: 'local' })).toBe(
          path.normalize(abs),
        );
      } finally {
        process.env.UPLOAD_ROOT_DIR = tmpDir;
      }
    });

    it('data: URL 在任何 refType 下都是 null', () => {
      expect(
        resolveModelVisiblePath({ url: 'data:image/png;base64,QUJD', refType: 'local' }),
      ).toBeNull();
    });
  });

  describe("resolveModelVisiblePath（'session' 形态：自包含引用 → 会话数据目录）", () => {
    const sessionRef = (url: string) => ({ url, refType: 'session' as const });

    it('正常引用 → <sessionsBase>/<id>/<相对路径>（无需 ctx，url 自包含）', () => {
      expect(resolveModelVisiblePath(sessionRef('sessions/s1/images/20260915/a.jpg'))).toBe(
        path.join(sessionsBase, 's1/images/20260915/a.jpg'),
      );
    });

    it('refType 缺省（历史数据）仍按 store 解释，不误入 session 分支', () => {
      // 缺省 refType 的 url 若是 sessions/ 形态，不会被当 session 解析（防历史数据串扰）
      expect(resolveModelVisiblePath({ url: 'sessions/s1/images/a.jpg' })).toBe(
        path.join(path.resolve(tmpDir), 'sessions/s1/images/a.jpg'),
      );
    });

    it('越出会话目录（.. 上跳）→ null', () => {
      expect(
        resolveModelVisiblePath(sessionRef('sessions/s1/images/../../other.jpg')),
      ).toBeNull();
      expect(resolveModelVisiblePath(sessionRef('sessions/s1/../../etc/passwd'))).toBeNull();
    });

    it('id 非法（分隔符/点前缀）→ null', () => {
      expect(resolveModelVisiblePath(sessionRef('sessions/a%2Fb/images/x.jpg'))).not.toBeNull();
      expect(resolveModelVisiblePath(sessionRef('sessions/../images/x.jpg'))).toBeNull();
      expect(resolveModelVisiblePath(sessionRef('sessions/.hidden/images/x.jpg'))).toBeNull();
      expect(resolveModelVisiblePath(sessionRef('sessions/undefined/images/x.jpg'))).toBeNull();
    });

    it('形态不对（缺段 / 绝对路径段）→ null', () => {
      expect(resolveModelVisiblePath(sessionRef('sessions/s1'))).toBeNull();
      expect(resolveModelVisiblePath(sessionRef('sessions/'))).toBeNull();
      expect(resolveModelVisiblePath(sessionRef('sessions/s1/C:\\abs\\x.jpg'))).toBeNull();
    });
  });

  describe("attachmentToPart（'session' 形态：传附件对象 → 从会话数据目录读字节）", () => {
    it('传整个附件对象时按 refType 分派（字符串形态仍按 store 解析）', async () => {
      // 在会话数据目录里放一张真实可读的图
      const dir = path.join(sessionsBase, 's9/images/20260915');
      await fs.mkdir(dir, { recursive: true });
      const raw = Buffer.from('session-image-bytes');
      await fs.writeFile(path.join(dir, 'a.jpg'), raw);

      // 对象形态 + refType='session' → 正确读盘
      const part = await attachmentToPart(
        { url: 'sessions/s9/images/20260915/a.jpg', refType: 'session' },
        'image/jpeg',
      );
      expect(part).toEqual({
        kind: 'base64',
        mimeType: 'image/jpeg',
        base64: raw.toString('base64'),
      });

      // 同内容字符串形态（store 语义）→ 指向错误目录，读不到 → null
      expect(await attachmentToPart('sessions/s9/images/20260915/a.jpg')).toBeNull();
    });

    it('session 形态越界/不存在 → null（不内联、不降级为 url）', async () => {
      const part = await attachmentToPart(
        { url: 'sessions/s9/images/../../x.jpg', refType: 'session' },
        'image/jpeg',
      );
      expect(part).toBeNull();
    });
  });
});
