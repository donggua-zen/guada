import { t } from '@/locales'

/**
 * 格式化时间显示
 */
export const formatTime = (dateString: string, style: string = 'friendly'): string => {
    if (!dateString) return ''

    const date = new Date(dateString)
    const dateTime = date.getTime()
    if (isNaN(dateTime)) return ''

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const dateCompare = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

    if (style !== 'friendly') {
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const diffDays = Math.floor((todayStart - dateCompare) / (24 * 60 * 60 * 1000))

    if (diffDays === 0) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    if (diffDays === 1) {
        return t('session.time.yesterday')
    }

    if (diffDays === 2) {
        return t('session.time.dayBeforeYesterday')
    }

    const day = date.getDay()
    const weekStart = todayStart - (now.getDay() === 0 ? 6 : now.getDay() - 1) * 24 * 60 * 60 * 1000

    if (dateCompare >= weekStart) {
        const weekDays = [
            t('session.time.sunday'),
            t('session.time.monday'),
            t('session.time.tuesday'),
            t('session.time.wednesday'),
            t('session.time.thursday'),
            t('session.time.friday'),
            t('session.time.saturday'),
        ]
        return weekDays[day]
    }

    const lastWeekStart = weekStart - 7 * 24 * 60 * 60 * 1000
    if (dateCompare >= lastWeekStart && dateCompare < weekStart) {
        return t('session.time.lastWeek')
    }

    if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
        return t('session.time.monthDay', { month: date.getMonth() + 1, day: date.getDate() })
    }

    return t('session.time.earlier')
}
