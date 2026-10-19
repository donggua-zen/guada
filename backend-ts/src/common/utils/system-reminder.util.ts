/**
 * 系统级注入文案的统一包裹。
 *
 * 模型侧的 wire 只携带 role + content；`kind='model'`、`metadata.hidden`、`source`
 * 等元数据不会发给模型。因此模型可见的“系统要求”必须在文本里用
 * `<system_reminder>` 标明，否则会被当成普通用户消息。
 */
export function wrapSystemReminder(text: string): string {
  return `<system_reminder>\n${text}\n</system_reminder>`;
}
