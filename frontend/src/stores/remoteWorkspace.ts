import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiService } from '@/services/ApiService'
import {
  connectionKind,
  connectionTargetLine,
  type RemoteConnection,
  type RemoteConnectionConfig,
} from '@/services/modules/remote-workspace.api'
import { SSH_CONNECTION_ATTACHMENT_TYPE } from '@/constants'

/**
 * 切换会话的附加目录绑定（纯函数）：在 attachments 上翻转某连接的绑定态，
 * 保留其余附件类型。所有绑定入口（WorkspaceSelectorPopover / WorkingDirBar /
 * TaskEditDialog）共用，保证多选语义与写回形状一致。
 */
export function toggleConnectionBinding(
  attachments: Record<string, string[]> | undefined,
  connectionId: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = { ...(attachments || {}) }
  const ids = Array.isArray(next[SSH_CONNECTION_ATTACHMENT_TYPE]) ? next[SSH_CONNECTION_ATTACHMENT_TYPE] : []
  next[SSH_CONNECTION_ATTACHMENT_TYPE] = ids.includes(connectionId)
    ? ids.filter((id) => id !== connectionId)
    : [...ids, connectionId]
  return next
}

/**
 * 远程工作区连接 Store
 * 统一管理 remote-workspace 连接清单，供设置页（CRUD）与聊天侧绑定入口
 * （WorkingDirBar / WorkspaceSelectorPopover）共享，任何一处的增删改都同步同一份列表。
 *
 * 错误约定：ensureConnections 失败静默（console.error，未加载成功可重试）；
 * CRUD 失败原样抛出，由调用方 catch 并用 ElMessage 呈现具体错误（如名称冲突）。
 */
export const useRemoteWorkspaceStore = defineStore('remoteWorkspace', () => {
  // ========== 状态 ==========

  /** 远程连接清单（后端原始形状） */
  const connections = ref<RemoteConnection[]>([])

  /** 是否已成功加载过（失败后保持 false，下次 ensureConnections 会重试） */
  const hasLoaded = ref(false)

  /** 连接清单加载状态 */
  const isLoading = ref(false)

  /** 进行中的加载请求（并发去重；置于 store 实例内，避免跨 pinia 实例泄漏） */
  let loadPromise: Promise<void> | null = null

  // ========== 计算属性 ==========

  /** 绑定入口下拉用的展示投影（两处聊天组件原本各自重复此映射） */
  const connectionOptions = computed(() =>
    connections.value.map((c) => ({
      id: c.id,
      name: c.name,
      /** 连接类型：绑定入口据此选图标（SSH 云 / 容器方块） */
      kind: connectionKind(c),
      /** 目标摘要：SSH → user@host；Docker → 容器名 */
      description: connectionTargetLine(c.config),
      /** 工作目录（清单行与提示展示用；未配置时兜底空串） */
      path: c.config.path || '',
    })),
  )

  // ========== Actions ==========

  /**
   * 确保连接清单已加载：已加载早退；并发调用共享同一请求（force 时若有
   * 进行中的加载同样复用）；force 忽略已加载缓存强制重拉。
   */
  const ensureConnections = async (force = false): Promise<void> => {
    if (loadPromise) return loadPromise
    if (!force && hasLoaded.value) return
    loadPromise = (async () => {
      isLoading.value = true
      try {
        const list = await apiService.getConnections()
        connections.value = list || []
        hasLoaded.value = true
      } catch (error) {
        console.error('加载远程连接失败:', error)
      } finally {
        isLoading.value = false
        loadPromise = null
      }
    })()
    return loadPromise
  }

  /** 就地更新或追加一条连接（CRUD 成功后的本地同步） */
  const upsertConnection = (conn: RemoteConnection): void => {
    const index = connections.value.findIndex((c) => c.id === conn.id)
    if (index !== -1) {
      connections.value[index] = conn
    } else {
      connections.value.push(conn)
    }
  }

  /**
   * 创建连接；失败抛出（调用方负责 ElMessage）
   */
  const createConnection = async (name: string, config: RemoteConnectionConfig): Promise<RemoteConnection> => {
    const conn = await apiService.createConnection(name, config)
    upsertConnection(conn)
    return conn
  }

  /**
   * 更新连接；失败抛出（调用方负责 ElMessage）
   */
  const updateConnection = async (
    id: string,
    data: { name?: string; config?: RemoteConnectionConfig },
  ): Promise<RemoteConnection> => {
    const conn = await apiService.updateConnection(id, data)
    upsertConnection(conn)
    return conn
  }

  /**
   * 删除连接；失败抛出（调用方负责 ElMessage）
   */
  const deleteConnection = async (id: string): Promise<{ success: boolean }> => {
    const result = await apiService.deleteConnection(id)
    if (result.success) {
      connections.value = connections.value.filter((c) => c.id !== id)
    }
    return result
  }

  return {
    // 状态
    connections,
    hasLoaded,
    isLoading,

    // 计算属性
    connectionOptions,

    // Actions
    ensureConnections,
    createConnection,
    updateConnection,
    deleteConnection,
  }
})
