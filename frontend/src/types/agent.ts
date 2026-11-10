/**
 * 智能体相关类型定义
 */

import type { ISODateString } from './common'

/**
 * 智能体对象
 *
 * id 即 `agents/<id>` 目录名，由 name 派生并保持稳定（改 name 不改 id）。
 * 定义权威来源为 `AGENT.md`（YAML frontmatter + Markdown 正文）。
 */
export interface Agent {
    id: string
    name: string
    description?: string | null
    avatarUrl?: string | null
    modelId?: string | null
    createdAt: ISODateString
    updatedAt: ISODateString
    settings?: AgentSettings
    /** 是否来自随包内置模板 */
    bundled?: boolean
    /**
     * 来源插件 ID（非空 = 插件注册的虚拟智能体）。
     * 不落盘、生命周期跟随插件；提示词与绑定能力锁定，其余配置可编辑。
     */
    pluginId?: string | null
    /**
     * 插件绑定的工具包（`${pluginId}:${kitId}`，含跨插件引用）。
     * 锁定"永远打开"：UI 开关禁用，后端豁免一切裁剪。
     */
    lockedToolkits?: string[]
    /** 插件绑定的技能 id（同样锁定常开） */
    lockedSkills?: string[]
}

/**
 * 智能体设置
 */
export interface AgentSettings {
    systemPrompt?: string
    temperature?: number
    max_tokens?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
    /** 兼容后端 settings 分组下的扩展键（memory/skills/plugins 等由各消费方收窄读取） */
    [key: string]: unknown
}

/**
 * 创建智能体请求数据
 */
export interface CreateAgentRequest {
    name: string
    description?: string
    /** null = 清除模型绑定（与 Agent.modelId 的可空语义对齐） */
    modelId?: string | null
    settings?: Partial<AgentSettings>
}

/**
 * 更新智能体请求数据
 */
export interface UpdateAgentRequest {
    name?: string
    description?: string
    modelId?: string | null
    settings?: Partial<AgentSettings>
}

/**
 * 智能体列表响应
 */
export interface AgentListResponse {
    items: Agent[]
    total: number
    page: number
    pageSize: number
}
