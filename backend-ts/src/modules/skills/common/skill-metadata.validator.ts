/**
 * 技能名称验证结果
 */
export interface SkillNameValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * 技能描述验证结果
 */
export interface SkillDescriptionValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * 技能元数据验证结果
 */
export interface SkillMetadataValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * 技能名称和描述验证工具类
 * 
 * 验证规则（硬性限制）：
 * - 名称（name）：
 *   - 最大 64 个字符
 *   - 只包含小写字符、数字、连字符（hyphens）
 *   - 不要把连字符作为开始和结束符号
 *   - 必须匹配目录名称（不区分大小写）
 * 
 * - 描述（description）：
 *   - 最大 1024 字符且非空
 * 
 * 注意：以下属于软性规范（建议但不强制）：
 * - 使用动名词形式（gerund form，即 ing 结尾）
 * - 描述能做什么（what）、什么时候使用（when）
 * - 包含关键词，帮助编程助手理解能处理的相关任务
 */
export class SkillMetadataValidator {
  /**
   * 验证技能名称
   * @param name 技能名称
   * @param dirName 目录名称（可选，如果提供则检查一致性）
   */
  static validateName(name: string, dirName?: string): SkillNameValidationResult {
    // 检查是否为空
    if (!name || name.trim().length === 0) {
      return {
        isValid: false,
        error: 'Skill name cannot be empty',
      };
    }

    // 检查长度限制（最大 64 个字符）
    if (name.length > 64) {
      return {
        isValid: false,
        error: `Skill name is too long (max 64 characters). Got: ${name.length} characters`,
      };
    }

    // 检查是否只包含小写字符、数字、连字符
    if (!/^[a-z0-9-]+$/.test(name)) {
      return {
        isValid: false,
        error: `Skill name contains invalid characters. Only lowercase letters, numbers, and hyphens are allowed. Got: "${name}"`,
      };
    }

    // 检查连字符不能作为开始和结束符号
    if (name.startsWith('-') || name.endsWith('-')) {
      return {
        isValid: false,
        error: 'Skill name must not start or end with a hyphen',
      };
    }

    // 如果提供了目录名称，检查一致性（不区分大小写）
    if (dirName) {
      if (name.toLowerCase() !== dirName.toLowerCase()) {
        return {
          isValid: false,
          error: `Skill name mismatch: SKILL.md declares '${name}' but directory is '${dirName}'. They must match (case-insensitive).`,
        };
      }
    }

    return { isValid: true };
  }

  /**
   * 验证技能描述
   * @param description 技能描述
   */
  static validateDescription(description: string): SkillDescriptionValidationResult {
    // 检查是否为空
    if (!description || description.trim().length === 0) {
      return {
        isValid: false,
        error: 'Skill description cannot be empty',
      };
    }

    // 检查长度限制（最大 1024 字符）
    if (description.length > 1024) {
      return {
        isValid: false,
        error: `Skill description is too long (max 1024 characters). Got: ${description.length} characters`,
      };
    }

    return { isValid: true };
  }

  /**
   * 验证完整的技能元数据（名称 + 描述）
   * @param name 技能名称
   * @param description 技能描述
   * @param dirName 目录名称（可选）
   */
  static validateMetadata(
    name: string,
    description: string,
    dirName?: string
  ): SkillMetadataValidationResult {
    const errors: string[] = [];

    // 验证名称
    const nameResult = this.validateName(name, dirName);
    if (!nameResult.isValid && nameResult.error) {
      errors.push(nameResult.error);
    }

    // 验证描述
    const descResult = this.validateDescription(description);
    if (!descResult.isValid && descResult.error) {
      errors.push(descResult.error);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * 检查名称是否符合动名词形式（ing 结尾）
   * @param name 技能名称
   */
  static isGerundForm(name: string): boolean {
    return name.endsWith('ing');
  }

  /**
   * 获取动名词形式的建议名称
   * @param name 原始名称
   */
  static suggestGerundName(name: string): string {
    // 如果已经是 ing 结尾，直接返回
    if (this.isGerundForm(name)) {
      return name;
    }

    // 移除可能的后缀并添加 ing
    const baseName = name
      .replace(/[-_]?tool$/, '')
      .replace(/[-_]?helper$/, '')
      .replace(/[-_]?utility$/, '')
      .replace(/[-_]?util$/, '')
      .trim();

    // 确保以 ing 结尾
    if (!baseName.endsWith('ing')) {
      return `${baseName}-ing`;
    }

    return baseName;
  }
}
