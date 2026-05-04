/**
 * SKILL.md YAML frontmatter 解析结构（L1 元数据）
 */
export interface SkillManifest {
  name: string;               // 技能名称（≤64字符，小写+数字+连字符）
  description: string;        // 技能描述（≤1024字符，第三人称）
  version?: string;           // 语义化版本 "1.0.0"
  dependencies?: string[];    // 依赖的其他 Skill 名称
  author?: string;            // 作者
  tags?: string[];            // 分类标签
}

/**
 * 完整 Skill 定义（内存表示）
 */
export interface SkillDefinition {
  id: string;                    // = manifest.name
  basePath: string;              // 文件系统绝对路径
  manifest: SkillManifest;       // 解析后的 YAML frontmatter
  contentHash: string;           // SHA256（用于变更检测）
}
