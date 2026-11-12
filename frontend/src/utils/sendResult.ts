import type { ChatFileView } from '@/types/session'

/**
 * 附件的稳定身份。
 *
 * 不能用对象引用比较：ChatInput 会用 toChatFileView 把编辑回填/历史附件映射成新对象，
 * 父组件持有的仍是原对象；上传进度回写也会替换元素对象。只要逻辑上是同一个附件，
 * 以下字段在整个生命周期内保持不变。
 */
function fileIdentity(file: ChatFileView): string {
  if (file.id !== undefined) return `id:${String(file.id)}`
  if (file.url) return `url:${file.url}`
  if (file.localPath) return `path:${file.localPath}`
  return `name:${file.fileName ?? file.displayName ?? file.name ?? ''}|${file.fileSize ?? file.size ?? 0}`
}

/** 两个附件列表是否仍是同一批（按稳定身份比较，而非对象引用） */
export function isSameFileList(
  current: readonly ChatFileView[],
  snapshot: readonly ChatFileView[],
): boolean {
  if (current.length !== snapshot.length) return false
  return current.every((file, index) => fileIdentity(file) === fileIdentity(snapshot[index]))
}

/**
 * 发送被服务端确认接收后，是否清空输入框。
 *
 * 输入框在等待期间仍可编辑：若用户已续写正文或增删附件，一律保留当前内容。
 * 宁可让已发送的旧文本留在框里让用户自己删，也不能把等待期间的新输入吞掉。
 */
export function shouldClearComposerAfterSend(input: {
  currentContent: string
  sentContent: string
  currentFiles: readonly ChatFileView[]
  sentFiles: readonly ChatFileView[]
}): boolean {
  return (
    input.currentContent === input.sentContent
    && isSameFileList(input.currentFiles, input.sentFiles)
  )
}
