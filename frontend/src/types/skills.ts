/**
 * 技能模块类型定义
 *
 * 与后端 backend-ts/src/modules/skills 的领域接口同构：
 * - Skill/SkillManifest ← interfaces/skill-manifest.interface.ts（SkillDefinition）
 * - SkillCommand        ← modules/commands 的 AggregatedItem（按触发方式聚合的命令条目）
 * 后端 SkillDefinition 的 content/resourceBase 等运行时内部字段不下发，此处不声明。
 */

/** SKILL.md YAML frontmatter（L1 元数据） */
export interface SkillManifest {
    /** 技能名称（≤64 字符，小写+数字+连字符；id 即由它派生） */
    name: string
    /** 技能描述（≤1024 字符，第三人称） */
    description: string
    version?: string
    dependencies?: string[]
    author?: string
    tags?: string[]
}

/** 技能来源：global=用户安装, system=系统内置, agents=共享目录, workspace=工作目录 */
export type SkillSourceType = 'system' | 'agents' | 'global' | 'workspace'

/** 完整技能定义（列表/详情接口的条目形状） */
export interface Skill {
    id: string
    manifest: SkillManifest
    source: SkillSourceType
    enabled: boolean
    /** 技能提供方名（溯源；如 "bundled"、"plugin:<id>"，缺省 = 非插件托管） */
    provider?: string
    basePath?: string
    baseDir?: string
    contentHash?: string
}

/** 命令条目（/ 命令面板数据源；label 等自定义字段由各命令提供者附加） */
export interface SkillCommand {
    /** 选中值，如 "coder"（对应标签中冒号后的部分） */
    name: string
    /** 前端展示描述 */
    description: string
    /** 提供者 id，如 "skill" */
    providerId: string
    /** 触发方式 */
    trigger: 'slash' | 'mention'
    /** 友好展示名（技能提供者附加；缺省回退 name） */
    label?: string
    /**
     * 本地命令（如 /compact）：选中后插入纯文本而非标签节点；发送前由前端/后端拦截执行，
     * 不写用户消息、不进 LLM 上下文。
     */
    local?: boolean
    /** 各提供者附加的自定义字段 */
    [key: string]: unknown
}
