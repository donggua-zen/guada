/**
 * 已安装技能的展示名/描述解析（仅 UI 展示用）。
 *
 * SKILL.md 可携带展示扩展字段（display_name / display_name_zh / display_name_en /
 * description_zh / description_en）。这些字段只用于界面展示，不参与 AI 上下文——
 * 后端注入给模型时始终只读 manifest.name / manifest.description。
 *
 * 取值优先级与市场服务端（ai_web metaFromFrontmatter）保持一致：
 *   zh: display_name_zh → display_name → name（display_name 等于 slug 时忽略）
 *   en: display_name_en → display_name → name（display_name 等于 slug 时忽略）
 */

import { getLocale } from '@/locales'
import type { SkillManifest } from '@/types/skills'

/** 与市场服务端一致：display_name 写成 slug（等于技能 id）时不可当展示名 */
function notSlug(value: string | undefined, slug: string): string {
    if (!value) return ''
    return value.trim().toLowerCase() === slug.toLowerCase() ? '' : value.trim()
}

/** 当前界面语言下的技能展示名 */
export function getSkillDisplayName(
    manifest: Pick<SkillManifest, 'name' | 'display_name' | 'display_name_zh' | 'display_name_en'>,
    skillId?: string,
): string {
    const slug = (skillId || manifest.name || '').toLowerCase()
    const isEn = getLocale().toLowerCase().startsWith('en')

    const localized = notSlug(isEn ? manifest.display_name_en : manifest.display_name_zh, slug)
    return localized || notSlug(manifest.display_name, slug) || manifest.name || skillId || ''
}

/** 当前界面语言下的技能展示描述（AI 侧仍使用 manifest.description） */
export function getSkillDisplayDescription(
    manifest: Pick<SkillManifest, 'description' | 'description_zh' | 'description_en'>,
): string {
    const isEn = getLocale().toLowerCase().startsWith('en')
    const localized = (isEn ? manifest.description_en : manifest.description_zh)?.trim()
    return localized || manifest.description || ''
}
