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
