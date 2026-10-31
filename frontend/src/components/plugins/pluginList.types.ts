/** 插件页紧凑列表行「…」菜单中的一项 */
export interface PluginRowMenuItem {
    command: string
    label: string
    disabled?: boolean
    danger?: boolean
    /** 原生 title 提示，用于解释禁用原因（如共享目录技能不可卸载） */
    title?: string
}

/** 插件页二级视图切换（已安装 / 市场）的一项 */
export interface PluginViewSwitchItem {
    value: string
    label: string
}
