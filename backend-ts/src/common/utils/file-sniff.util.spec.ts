import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import { sniffFileHead, decodeTextWithEncoding } from './file-sniff.util';

/**
 * 文件头嗅探：后缀不可信时判断「文本/二进制 + 真实格式 + 编码」。
 * 每个用例都写真实文件——嗅探的输入是字节，用 mock 会把被测逻辑本身绕过去。
 */
describe('sniffFileHead（无后缀/未知后缀文件的内容嗅探）', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-sniff-'));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  let seq = 0;
  async function writeFile(buf: Buffer | string): Promise<string> {
    const filePath = path.join(dir, `fixture-${seq++}`);
    await fs.writeFile(filePath, buf);
    return filePath;
  }

  it('无后缀纯 ASCII 文本 → 文本 / utf-8', async () => {
    const result = await sniffFileHead(await writeFile('hello world\nsecond line\n'));
    expect(result).toMatchObject({ isBinary: false, encoding: 'utf-8', reason: 'text' });
    expect(result.detectedExtension).toBe('');
  });

  it('无后缀 UTF-8 中文文本 → 文本 / utf-8', async () => {
    const result = await sniffFileHead(await writeFile('中文文本，带标点。\n'));
    expect(result).toMatchObject({ isBinary: false, encoding: 'utf-8', reason: 'text' });
  });

  it('无后缀 GBK 文本（高位字节、无 NUL）→ 文本 / gb18030，不是二进制', async () => {
    const result = await sniffFileHead(await writeFile(iconv.encode('中文文本，GBK 编码。\n', 'gb18030')));
    expect(result).toMatchObject({ isBinary: false, encoding: 'gb18030', reason: 'text' });
  });

  it('空文件 → 文本（保守：空内容不算二进制）', async () => {
    const result = await sniffFileHead(await writeFile(Buffer.alloc(0)));
    expect(result).toMatchObject({ isBinary: false, reason: 'text' });
  });

  it('NUL 字节 → 二进制（与 git.service 的 hasNulByte 同源）', async () => {
    const result = await sniffFileHead(await writeFile(Buffer.from([0x41, 0x42, 0x00, 0x43, 0x44])));
    expect(result).toMatchObject({ isBinary: true, reason: 'nul', mimeType: null });
  });

  it('控制字符占比过高 → 二进制', async () => {
    // 全部为 C0 控制符（不含被放行的 \t \n \v \f \r），无 NUL、无魔数
    const result = await sniffFileHead(await writeFile(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])));
    expect(result).toMatchObject({ isBinary: true, reason: 'control' });
  });

  describe('BOM 优先于 NUL 启发式', () => {
    it('UTF-8 BOM → 文本 / utf-8', async () => {
      const result = await sniffFileHead(
        await writeFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello')])),
      );
      expect(result).toMatchObject({ isBinary: false, encoding: 'utf-8', reason: 'bom' });
    });

    it('UTF-16LE BOM 文本（含 NUL 字节）→ 仍是文本 / utf-16le', async () => {
      const result = await sniffFileHead(
        await writeFile(Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode('hi 中文', 'utf-16le')])),
      );
      expect(result).toMatchObject({ isBinary: false, encoding: 'utf-16le', reason: 'bom' });
    });

    it('UTF-16BE BOM 文本（含 NUL 字节）→ 仍是文本 / utf-16be', async () => {
      const result = await sniffFileHead(
        await writeFile(Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode('hi', 'utf-16be')])),
      );
      expect(result).toMatchObject({ isBinary: false, encoding: 'utf-16be', reason: 'bom' });
    });

    it('UTF-32LE 的 BOM 不能被 UTF-16LE 抢走（4 字节优先）', async () => {
      const result = await sniffFileHead(
        await writeFile(Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x00]), Buffer.from([0x68, 0x00, 0x00, 0x00])])),
      );
      expect(result).toMatchObject({ isBinary: false, encoding: 'utf-32le', reason: 'bom' });
    });

    it('UTF-32BE BOM → 文本 / utf-32be', async () => {
      const result = await sniffFileHead(
        await writeFile(Buffer.concat([Buffer.from([0x00, 0x00, 0xfe, 0xff]), Buffer.from([0x00, 0x00, 0x00, 0x68])])),
      );
      expect(result).toMatchObject({ isBinary: false, encoding: 'utf-32be', reason: 'bom' });
    });
  });

  describe('魔数识别真实格式', () => {
    it('PNG → image/png / .png', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const result = await sniffFileHead(await writeFile(png));
      expect(result).toMatchObject({
        isBinary: true,
        reason: 'magic',
        mimeType: 'image/png',
        detectedExtension: '.png',
      });
    });

    it('PDF → application/pdf / .pdf', async () => {
      const result = await sniffFileHead(await writeFile('%PDF-1.4\n%âãÏÓ\n'));
      expect(result).toMatchObject({ isBinary: true, mimeType: 'application/pdf', detectedExtension: '.pdf' });
    });

    it('ZIP → application/zip / .zip', async () => {
      const result = await sniffFileHead(await writeFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])));
      expect(result).toMatchObject({ isBinary: true, mimeType: 'application/zip', detectedExtension: '.zip' });
    });

    it('MP4（ftyp 在 offset 4）→ video/mp4 / .mp4', async () => {
      const mp4 = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x18]),
        Buffer.from('ftyp'),
        Buffer.from('isom'),
        Buffer.from([0x00, 0x00, 0x00, 0x01]),
      ]);
      const result = await sniffFileHead(await writeFile(mp4));
      expect(result).toMatchObject({ isBinary: true, mimeType: 'video/mp4', detectedExtension: '.mp4' });
    });

    it('QuickTime（brand=qt）→ video/quicktime / .mov', async () => {
      const mov = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x14]),
        Buffer.from('ftyp'),
        Buffer.from('qt  '),
        Buffer.from([0x00, 0x00, 0x00, 0x01]),
      ]);
      const result = await sniffFileHead(await writeFile(mov));
      expect(result).toMatchObject({ isBinary: true, detectedExtension: '.mov' });
    });

    it('RIFF/WEBP → .webp（RIFF 靠 offset 8 的 form 区分）', async () => {
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from('WEBP')]);
      const result = await sniffFileHead(await writeFile(webp));
      expect(result).toMatchObject({ isBinary: true, mimeType: 'image/webp', detectedExtension: '.webp' });
    });

    it('RIFF/WAVE → .wav', async () => {
      const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from('WAVE')]);
      const result = await sniffFileHead(await writeFile(wav));
      expect(result).toMatchObject({ isBinary: true, mimeType: 'audio/wav', detectedExtension: '.wav' });
    });
  });

  it('已知局限：无 BOM 的 UTF-16 文本含 NUL，会被判成二进制', async () => {
    // 没有 BOM 就无从区分 UTF-16 与普通二进制，与大多数工具的取舍一致
    const result = await sniffFileHead(await writeFile(iconv.encode('hello', 'utf-16le')));
    expect(result.isBinary).toBe(true);
  });

  it('只读文件头，不因文件巨大而变慢（超长文件取头部判定）', async () => {
    const big = Buffer.concat([Buffer.from('a'.repeat(200_000)), Buffer.from([0x00])]);
    const result = await sniffFileHead(await writeFile(big), 8192);
    // 8192 字节的 'a' 里没有 NUL → 文本
    expect(result.isBinary).toBe(false);
  });
});

describe('decodeTextWithEncoding', () => {
  it('按编码解码，并剥掉残留的 BOM 字符', () => {
    const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello')]);
    expect(decodeTextWithEncoding(utf8Bom, 'utf-8')).toBe('hello');

    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode('中文', 'utf-16le')]);
    expect(decodeTextWithEncoding(utf16, 'utf-16le')).toBe('中文');

    const gbk = iconv.encode('中文', 'gb18030');
    expect(decodeTextWithEncoding(gbk, 'gb18030')).toBe('中文');
  });
});
