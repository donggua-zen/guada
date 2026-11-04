/**
 * 侧栏分组「新建会话」的入口参数解析（纯函数，便于单测）。
 *
 * 目录模式（按工作目录分组）下，侧栏每个分组的「+」按钮把目标工作目录写进
 * `workspaceStore` 的「上次选择」（不经过 URL —— 相同 URL 的 replace 是 no-op，
 * 停在新会话页时重复点同一分组不会触发导航钩子），由 `CreateSessionChatPanel`
 * watch 后套用。真实目录分组直接用分组自身的路径；虚拟「通用」桶没有路径，
 * 但它的语义是「不属于任何项目」，唯一稳定的落点就是公共目录 —— public 目录永不
 * 注册为项目分组（见后端 `qualifiesForProjectGroup`），因此用公共目录建出的会话
 * 仍然归「通用」。
 *
 * 不指定目标目录（返回 null）时，新建页回退到「上次选择」的本地记忆。
 */

/** 侧栏分组渲染项中本模块关心的字段 */
export interface NewSessionGroupRef {
  kind?: 'workspace' | 'general'
  path?: string | null
}

/**
 * 解析分组「新建会话」的目标工作目录。
 *
 * @param group 侧栏分组（目录分组带 path；虚拟「通用」桶 kind === 'general'）
 * @param publicPath 当前公共目录绝对路径（baseDir 未就绪时为 null）
 * @returns 目标工作目录；null = 不指定，交给新建页按「上次选择」推断
 */
export function resolveGroupWorkspacePath(
  group: NewSessionGroupRef,
  publicPath: string | null,
): string | null {
  if (group.kind === 'workspace') {
    return group.path || null
  }
  if (group.kind === 'general') {
    return publicPath || null
  }
  return null
}
