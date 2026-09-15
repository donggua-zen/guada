/**
 * 角色相关类型定义
 */

import type { ISODateString } from './common'

/**
 * 角色对象
 *
 * id 即 `agents/<id>` 目录名，由 name 派生并保持稳定（改 name 不改 id）。
 * 定义权威来源为 `AGENT.md`（YAML frontmatter + Markdown 正文）。
 */
export interface Character {
    id: string
    name: string
    description?: string | null
    avatarUrl?: string | null
    modelId?: string | null
    createdAt: ISODateString
    updatedAt: ISODateString
    settings?: CharacterSettings
    /** 是否来自随包内置模板 */
    bundled?: boolean
}

/**
 * 角色设置
 */
export interface CharacterSettings {
    systemPrompt?: string
    temperature?: number
    max_tokens?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
    [key: string]: any
}

/**
 * 创建角色请求数据
 */
export interface CreateCharacterRequest {
    name: string
    description?: string
    modelId?: string
    settings?: Partial<CharacterSettings>
}

/**
 * 更新角色请求数据
 */
export interface UpdateCharacterRequest {
    name?: string
    description?: string
    modelId?: string
    settings?: Partial<CharacterSettings>
}

/**
 * 角色列表响应
 */
export interface CharacterListResponse {
    items: Character[]
    total: number
    page: number
    pageSize: number
}
