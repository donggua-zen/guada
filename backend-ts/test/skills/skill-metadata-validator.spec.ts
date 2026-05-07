import { SkillMetadataValidator } from '../../src/modules/skills/common/skill-metadata.validator';

describe('SkillMetadataValidator', () => {
  describe('validateName', () => {
    it('应该接受符合规范的技能名称', () => {
      const validNames = [
        'code-reviewing',
        'data-analyzing',
        'text-formatting',
        'file-processing',
        'api-testing',
        'code-review',      // 不以 ing 结尾也是允许的（软性规范）
        'data-analyzer',    // 不以 ing 结尾也是允许的（软性规范）
      ];

      for (const name of validNames) {
        const result = SkillMetadataValidator.validateName(name, name);
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    it('应该拒绝超过64字符的名称', () => {
      const longName = 'a'.repeat(65);
      const result = SkillMetadataValidator.validateName(longName, longName);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('应该拒绝包含大写字母的名称', () => {
      const invalidNames = [
        'Code-Reviewing',
        'DATA-Analyzing',
        'Text-Formatting',
      ];

      for (const name of invalidNames) {
        const result = SkillMetadataValidator.validateName(name, name);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      }
    });

    it('应该拒绝包含特殊字符的名称', () => {
      const invalidNames = [
        'code_reviewing',
        'data.analyzing',
        'text/formatting',
        'file processing',
      ];

      for (const name of invalidNames) {
        const result = SkillMetadataValidator.validateName(name, name);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('invalid characters');
      }
    });

    it('应该拒绝以连字符开头或结尾的名称', () => {
      const invalidNames = [
        '-code-reviewing',
        'code-reviewing-',
        '-data-analyzing-',
      ];

      for (const name of invalidNames) {
        const result = SkillMetadataValidator.validateName(name, name);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('hyphen');
      }
    });

    it('应该拒绝名称与目录名不一致的情况', () => {
      const result = SkillMetadataValidator.validateName('code-reviewing', 'different-name');
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('mismatch');
    });

    it('应该接受名称与目录名一致（不区分大小写）', () => {
      const testCases = [
        { name: 'code-reviewing', dir: 'Code-Reviewing' },
        { name: 'data-analyzing', dir: 'DATA-ANALYZING' },
        { name: 'text-formatting', dir: 'Text-Formatting' },
      ];

      for (const { name, dir } of testCases) {
        const result = SkillMetadataValidator.validateName(name, dir);
        expect(result.isValid).toBe(true);
      }
    });
  });

  describe('validateDescription', () => {
    it('应该接受有效的描述', () => {
      const validDescriptions = [
        'A tool for reviewing code',
        'Helps analyze data and generate reports',
        'Formats text files according to specified rules',
      ];

      for (const desc of validDescriptions) {
        const result = SkillMetadataValidator.validateDescription(desc);
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    it('应该拒绝空描述', () => {
      const result = SkillMetadataValidator.validateDescription('');
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('应该拒绝超过1024字符的描述', () => {
      const longDesc = 'a'.repeat(1025);
      const result = SkillMetadataValidator.validateDescription(longDesc);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too long');
    });
  });

  describe('validateMetadata', () => {
    it('应该同时验证名称和描述', () => {
      const result = SkillMetadataValidator.validateMetadata(
        'code-reviewing',
        'A tool for reviewing code',
        'code-reviewing'
      );
      
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('应该收集所有错误', () => {
      const result = SkillMetadataValidator.validateMetadata(
        'INVALID_NAME',
        '',
        'different-name'
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe('isGerundForm', () => {
    it('应该正确识别动名词形式', () => {
      expect(SkillMetadataValidator.isGerundForm('reviewing')).toBe(true);
      expect(SkillMetadataValidator.isGerundForm('analyzing')).toBe(true);
      expect(SkillMetadataValidator.isGerundForm('formatting')).toBe(true);
      expect(SkillMetadataValidator.isGerundForm('review')).toBe(false);
      expect(SkillMetadataValidator.isGerundForm('analyzer')).toBe(false);
    });
  });

  describe('suggestGerundName', () => {
    it('应该为非动名词名称提供建议', () => {
      expect(SkillMetadataValidator.suggestGerundName('code-review')).toBe('code-review-ing');
      expect(SkillMetadataValidator.suggestGerundName('data-analyzer')).toBe('data-analyzer-ing');
    });

    it('应该保留已经是动名词形式的名称', () => {
      expect(SkillMetadataValidator.suggestGerundName('code-reviewing')).toBe('code-reviewing');
      expect(SkillMetadataValidator.suggestGerundName('data-analyzing')).toBe('data-analyzing');
    });

    it('应该移除常见后缀后添加 ing', () => {
      expect(SkillMetadataValidator.suggestGerundName('code-review-tool')).toBe('code-review-ing');
      expect(SkillMetadataValidator.suggestGerundName('data-analyzer-helper')).toBe('data-analyzer-ing');
    });
  });
});
