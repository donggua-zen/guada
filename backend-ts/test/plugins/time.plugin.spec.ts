import { Test, TestingModule } from '@nestjs/testing';
import { TimePlugin } from '../../src/modules/plugins/builtins/time.plugin';

describe('TimePlugin', () => {
  let plugin: TimePlugin;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TimePlugin],
    }).compile();

    plugin = module.get<TimePlugin>(TimePlugin);
  });

  it('should be defined', () => {
    expect(plugin).toBeDefined();
  });

  it('should have correct manifest', () => {
    expect(plugin.manifest.id).toBe('time');
    expect(plugin.manifest.name).toBe('时间工具');
    expect(plugin.manifest.description).toContain('获取当前详细时间信息');
    expect(plugin.manifest.category).toBe('core');
  });

  it('should define onLoad method', () => {
    expect(plugin.onLoad).toBeDefined();
  });

  describe('getTimeString', () => {
    it('should return full format by default', () => {
      // Access private method via prototype
      const result = (plugin as any).getTimeString({});
      expect(typeof result).toBe('string');
      expect(result).toContain('【当前详细时间信息】');
      expect(result).toContain('日期：');
      expect(result).toContain('星期：');
      expect(result).toContain('时间：');
      expect(result).toContain('时区：');
      expect(result).toContain('时间戳：');
    });

    it('should return ISO format when format=iso', () => {
      const result = (plugin as any).getTimeString({ format: 'iso' });
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should return locale format when format=locale', () => {
      const result = (plugin as any).getTimeString({ format: 'locale' });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should support timezone parameter', () => {
      const result = (plugin as any).getTimeString({ timezone: 'Asia/Tokyo', format: 'iso' });
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should handle invalid timezone gracefully', () => {
      // 无效时区在 full 格式下会触发 RangeError（toLocaleDateString 校验）
      expect(() => (plugin as any).getTimeString({ timezone: 'Invalid/Zone' }))
        .toThrow(RangeError);
    });
  });

  describe('getCurrentTimeString', () => {
    it('should return current time string for prompt injection', () => {
      const result = (plugin as any).getCurrentTimeString();
      expect(typeof result).toBe('string');
      expect(result).toContain('# Current Time');
    });
  });
});
