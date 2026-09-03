import { mimeFromExtension, normalizeMediaType, isImageMediaType } from './media-type.util';

describe('media-type.util', () => {
  describe('mimeFromExtension', () => {
    it('常见扩展名 → MIME（jpg→jpeg 归一）', () => {
      expect(mimeFromExtension('png')).toBe('image/png');
      expect(mimeFromExtension('jpg')).toBe('image/jpeg');
      expect(mimeFromExtension('jpeg')).toBe('image/jpeg');
      expect(mimeFromExtension('pdf')).toBe('application/pdf');
      expect(mimeFromExtension('md')).toBe('text/markdown');
    });

    it('带点扩展名与大小写不敏感', () => {
      expect(mimeFromExtension('.PNG')).toBe('image/png');
      expect(mimeFromExtension('JPG')).toBe('image/jpeg');
    });

    it('未知扩展回退 application/octet-stream', () => {
      expect(mimeFromExtension('xyz')).toBe('application/octet-stream');
      expect(mimeFromExtension(undefined)).toBe('application/octet-stream');
      expect(mimeFromExtension('')).toBe('application/octet-stream');
    });
  });

  describe('normalizeMediaType', () => {
    it('合法 MIME 原样返回', () => {
      expect(normalizeMediaType('image/png')).toBe('image/png');
      expect(normalizeMediaType('Image/JPEG')).toBe('image/jpeg');
      expect(normalizeMediaType('image/svg+xml')).toBe('image/svg+xml');
    });

    it('旧语义值（fileType=类别）按扩展名兜底——修复 image 块误判', () => {
      expect(normalizeMediaType('image', 'png')).toBe('image/png');
      expect(normalizeMediaType('image', 'jpg')).toBe('image/jpeg');
      expect(normalizeMediaType('text', 'md')).toBe('text/markdown');
    });

    it('非法值与缺省回退 octet-stream', () => {
      expect(normalizeMediaType(undefined, undefined)).toBe('application/octet-stream');
      expect(normalizeMediaType('', '')).toBe('application/octet-stream');
      expect(normalizeMediaType('image', '')).toBe('application/octet-stream');
    });
  });

  describe('isImageMediaType', () => {
    it('image/* 前缀判定', () => {
      expect(isImageMediaType('image/png')).toBe(true);
      expect(isImageMediaType('IMAGE/JPEG')).toBe(true);
      expect(isImageMediaType('application/pdf')).toBe(false);
      expect(isImageMediaType(undefined)).toBe(false);
    });
  });
});
