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
 * 技能来源类型
 */
export type SkillSourceType = 'system' | 'agents' | 'global' | 'workspace';

/**
 * 完整 Skill 定义（内存表示）
 */
/**
 * 技能资源基（参考 DSH resourceBase）
 * 模型以它为基准 + SKILL.md 内的相对路径访问脚本/资源，避免硬编码绝对路径。
 */
export type SkillResourceBase =
  | { kind: "directory"; path: string }
  | { kind: "url"; url: string }
  | { kind: "opaque"; description: string };

export interface SkillDefinition {
  id: string;                    // = manifest.name
  baseDir: string;               // 技能根目录（skillsDir），用于还原绝对路径
  basePath: string;              // 相对 baseDir 的路径（如 "pubchem-database"）
  manifest: SkillManifest;       // 解析后的 YAML frontmatter
  contentHash: string;           // SHA256（用于变更检测）
  source: SkillSourceType;       // 技能来源：global=用户安装, system=系统内置
  enabled: boolean;              // 是否启用（默认 true）
  /** 内嵌正文（注册式技能直接持有，不为空时 loadInstructions 不读文件） */
  content?: string;
  /** 技能提供方名（溯源；如 "bundled"、"plugin:<id>"） */
  provider?: string;
  /** 资源基：模型按此 + 相对路径访问脚本/资源（未声明时默认技能目录） */
  resourceBase?: SkillResourceBase;
}

/**
 * skill_learn 的返回：技能正文 + 位置信息。
 *
 * 位置信息是技能自带脚本/随附资源的落点——模型必须拿到它才能执行脚本，
 * 因此由 skill_learn 写进正文（而非返回对象里可能被丢弃的字段）。
 */
export interface SkillLearnResult {
  name: string;
  content: string;
  /** 兼容保留：文件型=SKILL.md 绝对路径；插件注册型=资源目录；均未知时为空串 */
  path: string;
  /** 声明的资源基；未声明且无技能目录时为 null */
  resourceBase: SkillResourceBase | null;
  /** 脚本/资源根目录；来源未知时为 null（不编造路径） */
  baseDirectory: string | null;
  /** 文件型技能的 SKILL.md 绝对路径；插件注册型（无磁盘文件）为 null */
  skillMdPath: string | null;
}
