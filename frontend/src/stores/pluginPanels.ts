import { defineStore } from 'pinia'

/**
 * 插件侧面板状态（v3 `conversation.side.panel`）
 *
 * - 同一时间只打开一个面板（与工作区侧栏共用右侧 dock 通道）。
 * - 按会话记忆选择：切会话后回到该会话上次打开的面板。
 * - 插件被禁用时由 ChatPage 兜底调用 `close()`，避免白屏。
 */
export interface ActivePanel {
  pluginId: string
  slotKey: string
}

interface PanelState {
  active: ActivePanel | null
  /** sessionId → 上次打开的面板（仅内存，不持久化） */
  bySession: Record<string, ActivePanel | null>
}

export const usePluginPanels = defineStore('pluginPanels', {
  state: (): PanelState => ({
    active: null,
    bySession: {},
  }),

  getters: {
    isOpen: (state) => state.active !== null,
  },

  actions: {
    open(pluginId: string, slotKey: string, sessionId?: string) {
      const next = { pluginId, slotKey }
      this.active = next
      if (sessionId) this.bySession[sessionId] = next
    },

    close(sessionId?: string) {
      this.active = null
      if (sessionId) this.bySession[sessionId] = null
    },

    toggle(pluginId: string, slotKey: string, sessionId?: string) {
      if (this.active?.pluginId === pluginId && this.active?.slotKey === slotKey) {
        this.close(sessionId)
      } else {
        this.open(pluginId, slotKey, sessionId)
      }
    },

    /** 会话切换：恢复该会话上次的面板（没有则关闭） */
    restoreForSession(sessionId: string | undefined) {
      this.active = sessionId ? this.bySession[sessionId] || null : null
    },
  },
})
