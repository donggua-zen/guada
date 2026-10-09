// stores/workspaceTree.ts
// 工作目录目录树的数据层：会话级树数据、展开状态、SSE 增量更新。
// 视图归 FilePreviewPanel / WorkspaceTreePanel 所有；多个视图实例共享同一份数据。
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiService, type FileChangeEvent } from '@/services/ApiService'
import { useTabStore } from '@/stores/tab'
import type { WorkspaceNode } from '@/types/workspace'

export const useWorkspaceTreeStore = defineStore('workspaceTree', () => {
  // ── 状态（会话级：切换会话时整体重置） ──
  const sessionId = ref<string | null>(null)
  const treeData = ref<WorkspaceNode[]>([])
  const expandedPaths = ref<Set<string>>(new Set())
  const loadingPaths = ref<Set<string>>(new Set())
  const isLoading = ref(false)
  const workspacePath = ref<string | null>(null)
  /** 文件变更版本号（SSE change 事件递增，驱动 FilePreviewPanel 重载） */
  const fileChangeVersions = ref<Record<string, number>>({})

  /** 并发加载代际：会话切换/强制刷新时作废旧请求结果 */
  let treeLoadGeneration = 0

  // 工作目录绝对路径：会话级缓存 + 在途去重。
  //
  // 后端的 workspace-path 是**派生值**（session.workspacePath ?? 全局 baseDir + sessionId）
  // 且解析时确保目录存在，所以不该由多个组件各问一次——目录树、输入区工作目录条、
  // 文件预览都共享这里的同一份结果。缓存按 sid 存而不是复用 workspacePath.value：
  // 消费方（如 WorkingDirBar）可能早于本 store 同步到该会话，此时 sessionId 还是 null。
  let cachedWorkspacePath: { sid: string; path: string } | null = null
  let workspacePathPromise: Promise<string | null> | null = null
  let workspacePathSessionId: string | null = null

  /**
   * 确保拿到会话的工作目录绝对路径。
   * @param force 跳过缓存重新解析（会话内工作目录可能被迁移/重绑时用）
   */
  function ensureWorkspacePath(sid: string, force = false): Promise<string | null> {
    if (!sid) return Promise.resolve(null)

    // 命中缓存：同会话且已解析过 → 不再请求
    if (!force && cachedWorkspacePath?.sid === sid) {
      return Promise.resolve(cachedWorkspacePath.path)
    }

    if (workspacePathPromise && workspacePathSessionId === sid) {
      return workspacePathPromise
    }

    workspacePathSessionId = sid
    workspacePathPromise = apiService.getWorkspacePath(sid)
      .then(resp => {
        const path = resp.workspacePath || null
        if (path) {
          cachedWorkspacePath = { sid, path }
          // 只在本 store 当前会话一致时写目录树用的值，避免串会话污染
          if (sessionId.value === sid) workspacePath.value = path
        }
        return path
      })
      .catch(() => null)
      .finally(() => {
        workspacePathPromise = null
        workspacePathSessionId = null
      })
    return workspacePathPromise
  }

  /**
   * 会话切换时重置（或首次初始化）。
   * 返回 false 表示只是重复同步同一会话，调用方无需后续动作。
   */
  function resetForSession(sid: string | null): boolean {
    if (sessionId.value === sid) return false
    const prevSid = sessionId.value
    sessionId.value = sid
    treeLoadGeneration++
    isLoading.value = false
    treeData.value = []
    expandedPaths.value = new Set()
    loadingPaths.value = new Set()
    fileChangeVersions.value = {}
    workspacePath.value = null
    // 路径缓存只在「切到另一个会话、且缓存不属于该会话」时失效：
    // - 首次初始化（null → sid）不清：否则作废 WorkingDirBar 早一步解析好的结果；
    // - 切到 sid 时若缓存已是 sid 的（WorkingDirBar 先一步解析），也不清：
    //   这样两条消费方无论谁先跑，同一会话都只解析一次。
    // 切走时旧会话的缓存会被丢弃，因此之后再回到该会话会重新解析（拿最新的迁移结果）。
    if (prevSid !== null && prevSid !== sid && cachedWorkspacePath?.sid !== sid) {
      cachedWorkspacePath = null
    }
    return true
  }

  /** 递归合并树数据，保留已加载的子节点（避免刷新时丢失懒加载的 children） */
  function mergeTreeData(oldNodes: WorkspaceNode[], newNodes: WorkspaceNode[]): WorkspaceNode[] {
    const oldMap = new Map(oldNodes.map(n => [n.path, n]))
    return newNodes.map(newNode => {
      const old = oldMap.get(newNode.path)
      if (old?.children?.length) {
        return { ...newNode, children: mergeTreeData(old.children, newNode.children || []) }
      }
      return newNode
    })
  }

  /** 加载工作目录树根层（force=true 时无视加载中状态强制发起） */
  async function loadTree(sid: string, force = false): Promise<void> {
    if (!sid) return
    if (isLoading.value && !force) return

    const generation = ++treeLoadGeneration
    isLoading.value = true
    try {
      const response = await apiService.getWorkspaceTree(sid)
      if (generation !== treeLoadGeneration || sid !== sessionId.value) return

      treeData.value = mergeTreeData(treeData.value, response.tree || [])

      if (!workspacePath.value) {
        const p = await ensureWorkspacePath(sid)
        if (generation === treeLoadGeneration && sid === sessionId.value) {
          workspacePath.value = p
        }
      }
    } catch (error) {
      if (generation === treeLoadGeneration && sid === sessionId.value) {
        console.error('Failed to load workspace tree:', error)
      }
    } finally {
      if (generation === treeLoadGeneration) {
        isLoading.value = false
      }
    }
  }

  /** 刷新树（清空数据重新加载） */
  function refresh(): void {
    const sid = sessionId.value
    if (!sid) return
    treeData.value = []
    void loadTree(sid, true)
  }

  /** 异步加载目录的子节点 */
  async function loadChildren(sid: string, node: WorkspaceNode): Promise<WorkspaceNode[]> {
    if (!sid) return []
    try {
      const response = await apiService.getWorkspaceChildren(sid, node.path)
      return response.children || []
    } catch (error) {
      console.error('[WorkspaceTree] Failed to load children:', error)
      return []
    }
  }

  /** 展开/折叠目录；展开时若子节点未加载则懒加载 */
  async function toggleNode(node: WorkspaceNode, expanded: boolean): Promise<void> {
    if (expanded) {
      expandedPaths.value = new Set(expandedPaths.value).add(node.path)
    } else {
      const next = new Set(expandedPaths.value)
      next.delete(node.path)
      expandedPaths.value = next
      return
    }

    if (!node.isDirectory) return
    const sid = sessionId.value
    if (!sid) return

    loadingPaths.value = new Set(loadingPaths.value).add(node.path)
    try {
      node.children = await loadChildren(sid, node)
    } finally {
      const next = new Set(loadingPaths.value)
      next.delete(node.path)
      loadingPaths.value = next
    }
  }

  function resetExpandedPaths(): void {
    expandedPaths.value = new Set()
  }

  /** 根据路径查找节点（path 为空返回虚拟根节点） */
  function findNodeByPath(nodes: WorkspaceNode[], path: string): WorkspaceNode | null {
    if (!path) {
      return { name: '', path: '', isDirectory: true, children: nodes }
    }
    for (const node of nodes) {
      if (node.path === path) return node
      if (node.children && node.children.length > 0) {
        const found = findNodeByPath(node.children, path)
        if (found) return found
      }
    }
    return null
  }

  /**
   * 展开选中文件的所有祖先目录（含懒加载）。
   * 滚动定位由视图层负责（TreeView.scrollToKey）。
   */
  async function revealPath(path: string): Promise<void> {
    if (!path) return
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join('/')
      const node = findNodeByPath(treeData.value, ancestorPath)
      if (!node?.isDirectory) return
      if (!expandedPaths.value.has(ancestorPath)) {
        expandedPaths.value = new Set(expandedPaths.value).add(ancestorPath)
      }
      if (!node.children || node.children.length === 0) {
        const sid = sessionId.value
        if (!sid) return
        loadingPaths.value = new Set(loadingPaths.value).add(node.path)
        try {
          node.children = await loadChildren(sid, node)
        } finally {
          const next = new Set(loadingPaths.value)
          next.delete(node.path)
          loadingPaths.value = next
        }
      }
    }
  }

  /**
   * SSE 文件变化事件 → 本地增量更新（不再请求后端 API）。
   * heartbeat / git 事件忽略（分别由 SSE 客户端与 GitStore 消费）。
   *
   * change / unlink 不依赖目录树状态：版本号是扁平映射、标签按路径匹配，
   * 语义上都不需要「父目录已展开」。若以父节点未加载为由丢弃，深层文件
   * （页面刷新后恢复的标签、聊天链接打开、树刷新后）会静默收不到刷新信号。
   * 只有 add/addDir 需要插入位置，才必须父节点已在树中。
   */
  function applyFileChange(event: FileChangeEvent): void {
    if (event.type === 'heartbeat' || event.type === 'git') return
    if (!event.path) return

    const normalizedPath = event.path.replace(/\\/g, '/')

    if (event.type === 'change') {
      bumpFileChangeVersion(normalizedPath)
      return
    }

    if (event.type === 'unlink' || event.type === 'unlinkDir') {
      closeTabsUnder(normalizedPath, event.type === 'unlinkDir')
      removeTreeNode(normalizedPath)
      return
    }

    // add / addDir：父节点尚未加载（未展开过）则忽略，根目录始终视为已加载
    const parts = normalizedPath.split('/')
    const fileName = parts[parts.length - 1]
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : ''

    const parentNode = findNodeByPath(treeData.value, parentPath)
    if (!parentNode) return
    if (!parentNode.children && parentNode.path !== '') return
    if (!parentNode.children) parentNode.children = []
    if (parentNode.children.some(child => child.name === fileName)) return

    parentNode.children.push({
      name: fileName,
      path: normalizedPath,
      isDirectory: event.type === 'addDir',
      hasChildren: event.type === 'addDir',
    })
    parentNode.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  /** 递增某路径的变更版本号（驱动已打开的 FilePreviewPanel 重载） */
  function bumpFileChangeVersion(normalizedPath: string): void {
    fileChangeVersions.value = {
      ...fileChangeVersions.value,
      [normalizedPath]: (fileChangeVersions.value[normalizedPath] || 0) + 1,
    }
  }

  /** 关闭受删除影响的文件标签：文件按路径精确匹配，目录匹配其下全部文件 */
  function closeTabsUnder(normalizedPath: string, isDirectory: boolean): void {
    const prefix = `${normalizedPath}/`
    const tabStore = useTabStore()
    const affected = tabStore.tabs.filter(tab => {
      if (tab.type !== 'file' || !tab.path) return false
      const tabPath = tab.path.replace(/\\/g, '/')
      return isDirectory ? tabPath.startsWith(prefix) : tabPath === normalizedPath
    })
    affected.forEach(tab => tabStore.removeTab(tab.key))
  }

  /** 从树中移除节点（父节点未加载时无树可改，静默跳过） */
  function removeTreeNode(normalizedPath: string): void {
    const parts = normalizedPath.split('/')
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    const parentNode = findNodeByPath(treeData.value, parentPath)
    if (!parentNode?.children) return
    const fileName = parts[parts.length - 1]
    const rmIdx = parentNode.children.findIndex(child => child.name === fileName)
    if (rmIdx !== -1) parentNode.children.splice(rmIdx, 1)
  }

  /** 重命名后清除旧路径的变更版本号 */
  function clearFileChangeVersion(path: string): void {
    delete fileChangeVersions.value[path]
  }

  return {
    sessionId,
    treeData,
    expandedPaths,
    loadingPaths,
    isLoading,
    workspacePath,
    fileChangeVersions,
    ensureWorkspacePath,
    resetForSession,
    loadTree,
    refresh,
    toggleNode,
    resetExpandedPaths,
    findNodeByPath,
    revealPath,
    applyFileChange,
    clearFileChangeVersion,
  }
})
