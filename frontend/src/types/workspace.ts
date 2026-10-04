/**
 * 工作目录模块类型定义
 */

/** 工作目录树节点（后端 workspace/tree 与 workspace/children 端点的条目形状） */
export interface WorkspaceNode {
    name: string
    path: string
    isDirectory: boolean
    children?: WorkspaceNode[]
    size?: number
    /** 目录是否已知有子项（懒加载标记） */
    hasChildren?: boolean
}
