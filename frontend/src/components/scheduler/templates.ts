import type { ScheduleDraft } from './schedule'

/**
 * 内置任务模板。
 *
 * 只描述「标题 / 描述 / 指令 / 调度」，点击后在新建弹窗里预填，
 * 用户仍可继续修改；文案走 i18n，调度走与调度句相同的草稿结构。
 */
export interface TaskTemplate {
  id: string
  titleKey: string
  descriptionKey: string
  promptKey: string
  schedule: ScheduleDraft
}

function schedule(partial: Partial<ScheduleDraft>): ScheduleDraft {
  return {
    frequency: 'daily',
    hour: 9,
    minute: 0,
    intervalHours: 2,
    weekdays: [1],
    monthDays: [1],
    onceAt: '',
    cronExpression: '',
    ...partial,
  }
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'daily-news',
    titleKey: 'scheduler.templates.items.dailyNews.title',
    descriptionKey: 'scheduler.templates.items.dailyNews.description',
    promptKey: 'scheduler.templates.items.dailyNews.prompt',
    schedule: schedule({ frequency: 'daily', hour: 9, minute: 0 }),
  },
  {
    id: 'weekly-report',
    titleKey: 'scheduler.templates.items.weeklyReport.title',
    descriptionKey: 'scheduler.templates.items.weeklyReport.description',
    promptKey: 'scheduler.templates.items.weeklyReport.prompt',
    schedule: schedule({ frequency: 'weekly', hour: 17, minute: 0, weekdays: [5] }),
  },
  {
    id: 'code-review',
    titleKey: 'scheduler.templates.items.codeReview.title',
    descriptionKey: 'scheduler.templates.items.codeReview.description',
    promptKey: 'scheduler.templates.items.codeReview.prompt',
    schedule: schedule({ frequency: 'weekdays', hour: 18, minute: 0 }),
  },
  {
    id: 'todo-plan',
    titleKey: 'scheduler.templates.items.todoPlan.title',
    descriptionKey: 'scheduler.templates.items.todoPlan.description',
    promptKey: 'scheduler.templates.items.todoPlan.prompt',
    schedule: schedule({ frequency: 'daily', hour: 9, minute: 30 }),
  },
  {
    id: 'dependency-check',
    titleKey: 'scheduler.templates.items.dependencyCheck.title',
    descriptionKey: 'scheduler.templates.items.dependencyCheck.description',
    promptKey: 'scheduler.templates.items.dependencyCheck.prompt',
    schedule: schedule({ frequency: 'weekly', hour: 10, minute: 0, weekdays: [1] }),
  },
  {
    id: 'knowledge-digest',
    titleKey: 'scheduler.templates.items.knowledgeDigest.title',
    descriptionKey: 'scheduler.templates.items.knowledgeDigest.description',
    promptKey: 'scheduler.templates.items.knowledgeDigest.prompt',
    schedule: schedule({ frequency: 'weekly', hour: 20, minute: 0, weekdays: [0] }),
  },
]
