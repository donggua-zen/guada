/**
 * 「远程目录」按钮的展示文案合成（纯函数）。
 *
 * 已绑定连接以 ID 存在 settings.attachments 里，而按钮角标 tooltip 要给人看的名称：
 * 连接清单未加载/已被删除时回退用原始 ID；选了十来个时提示条会过长，故只保留前若干名称。
 */

/** 解析名称所需的最小字段（remoteWorkspaceStore.connectionOptions 的子集） */
export interface RemoteDirNameSource {
    id: string
    name: string
}

/** 提示条里名称之间的分隔符（中英通用，免去按语言分支） */
export const REMOTE_DIR_NAME_SEPARATOR = ' · '
/** 提示条最多展示的名称个数，其余折叠为「等 N 个」 */
export const REMOTE_DIR_TOOLTIP_MAX_NAMES = 3

/** 已绑定连接 ID → 展示名称（清单里找不到的回退用原始 ID：连接可能已删除，绑定仍留在草稿/会话里） */
export function resolveRemoteDirNames(ids: string[], sources: RemoteDirNameSource[]): string[] {
    return ids.map((id) => sources.find((s) => s.id === id)?.name || id)
}

/**
 * 名称列表 → 提示条文本（超过 max 个只展示前 max 个，其余交给 moreLabel 折叠计数）
 * @param moreLabel 折叠计数文案（由调用方按当前语言给出，如「等 12 个」）
 */
export function formatRemoteDirNames(
    names: string[],
    moreLabel: (n: number) => string,
    max: number = REMOTE_DIR_TOOLTIP_MAX_NAMES,
): string {
    if (names.length === 0) return ''
    if (names.length <= max) return names.join(REMOTE_DIR_NAME_SEPARATOR)
    const shown = names.slice(0, max).join(REMOTE_DIR_NAME_SEPARATOR)
    return `${shown} ${moreLabel(names.length - max)}`
}
