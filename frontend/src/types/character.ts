/**
 * 角色相关类型定义
 */

import type { ISODateString } from './common'

/**
 * 角色类型（私有/共享）
 */
export type CharacterType = 'private' | 'public' | 'system'

/**
 * 角色分组对象
 */
export interface CharacterGroup {
    id: string
    name: string
    userId: string
    sortOrder: number
    createdAt: ISODateString
    updatedAt: ISODateString
}

/**
 * 角色对象
 */
export interface Character {
    id: string
    title: string
    description?: string
    systemPrompt?: string
    avatarUrl?: string
    userId: string
    type: CharacterType
    isActive: boolean
    groupId?: string | null
    group?: CharacterGroup | null
    createdAt: ISODateString
    updatedAt: ISODateString
    settings?: CharacterSettings
}

/**
 * 角色设置
 */
export interface CharacterSettings {
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
    title: string
    description?: string
    systemPrompt?: string
    avatar?: string
    type?: CharacterType
    settings?: Partial<CharacterSettings>
}

/**
 * 更新角色请求数据
 */
export interface UpdateCharacterRequest {
    title?: string
    description?: string
    systemPrompt?: string
    avatar?: string
    isActive?: boolean
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
