import {
  mimeFromExtension,
  normalizeMediaType,
  isVisionImageMediaType,
  isRasterImageExtension,
  RASTER_IMAGE_EXTENSIONS,
} from './media-type.util';

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

  describe('isVisionImageMediaType（块形态判定的唯一入口）', () => {
    it('位图 MIME → true（大小写无关）', () => {
      expect(isVisionImageMediaType('image/png')).toBe(true);
      expect(isVisionImageMediaType('IMAGE/JPEG')).toBe(true);
      expect(isVisionImageMediaType('image/webp')).toBe(true);
      expect(isVisionImageMediaType('image/avif')).toBe(true);
    });

    it('image/ 前缀但不可内联的类型 → false（前缀判定会漏判的那一类）', () => {
      // 三者 sharp 都转不了码、视觉模型也不接受，必须落 file 块走路径引用
      expect(isVisionImageMediaType('image/svg+xml')).toBe(false);
      expect(isVisionImageMediaType('image/x-icon')).toBe(false);
      expect(isVisionImageMediaType('image/vnd.adobe.photoshop')).toBe(false);
    });

    it('非图片与空值 → false', () => {
      expect(isVisionImageMediaType('application/pdf')).toBe(false);
      expect(isVisionImageMediaType('application/octet-stream')).toBe(false);
      expect(isVisionImageMediaType(undefined)).toBe(false);
      expect(isVisionImageMediaType(null)).toBe(false);
    });
  });

  describe('isRasterImageExtension（上传转码分支的准入）', () => {
    it('位图扩展名 → true（带点/大小写无关）', () => {
      expect(isRasterImageExtension('png')).toBe(true);
      expect(isRasterImageExtension('.JPG')).toBe(true);
      expect(isRasterImageExtension('tif')).toBe(true);
    });

    it('非位图"图片"扩展名 → false', () => {
      for (const ext of ['svg', 'ico', 'psd', 'ai', 'eps']) {
        expect(isRasterImageExtension(ext)).toBe(false);
      }
    });
  });

  describe('位图 MIME 白名单与光栅扩展名表的一致性', () => {
    it('每个光栅扩展名都能推出白名单内的 MIME', () => {
      // 防漂移：两张表任一改了而另一张没跟上，就会重新出现"选了图片却落 file 块"或反之
      const mismatched = RASTER_IMAGE_EXTENSIONS.filter(
        (ext) => !isVisionImageMediaType(mimeFromExtension(ext)),
      );
      expect(mismatched).toEqual([]);
    });
  });
});
