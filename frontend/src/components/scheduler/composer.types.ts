/**
 * 定时任务指令输入框的受控值。
 */
export interface SchedulerComposerValue {
  prompt: string
  agentId: string
  modelId: string
  thinkingEffort: string
  workspacePath: string
  attachments: Record<string, string[]>
  targetMode: 'new_session' | 'existing_session'
  outputMode: 'independent' | 'merged'
  targetSessionId: string
  unattended: boolean
}
