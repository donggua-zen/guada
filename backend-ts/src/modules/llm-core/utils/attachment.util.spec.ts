import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  attachmentToPart,
  attachmentToDataUrl,
  fileBlockToText,
  resolvePhysicalPath,
} from './attachment.util';

describe('attachment.util', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-util-'));
    process.env.UPLOAD_ROOT_DIR = tmpDir;
  });

  afterAll(async () => {
    delete process.env.UPLOAD_ROOT_DIR;
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

  describe('fileBlockToText', () => {
    it('优先使用 name 与 url', () => {
      expect(
        fileBlockToText({ name: 'a.pdf', url: 'uploads/files/a.pdf', attachmentId: 'f1' }),
      ).toBe('[文件: a.pdf (uploads/files/a.pdf)]');
    });

    it('缺 name/url 时回退 attachmentId', () => {
      expect(fileBlockToText({ attachmentId: 'f2' })).toBe('[文件: f2 (f2)]');
    });
  });
});
