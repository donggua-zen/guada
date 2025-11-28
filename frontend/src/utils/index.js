
export const formatTime = (dateString) => {

    if (!dateString) return ''

    const date = new Date(dateString)
    if (isNaN(date.getTime())) return '' // 防止无效日期

    const now = new Date()

    // 当天
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    // 昨天
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) {
        return '昨天'
    }

    // 前天
    const dayBeforeYesterday = new Date(now)
    dayBeforeYesterday.setDate(now.getDate() - 2)
    if (date.toDateString() === dayBeforeYesterday.toDateString()) {
        return '前天'
    }

    // 本周（周一为起始）
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1)) // 周一为每周第一天
    weekStart.setHours(0, 0, 0, 0)

    if (date >= weekStart) {
        const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        return weekDays[date.getDay()]
    }

    // 上周
    const lastWeekStart = new Date(weekStart)
    lastWeekStart.setDate(weekStart.getDate() - 7)
    const lastWeekEnd = new Date(weekStart)
    lastWeekEnd.setDate(weekStart.getDate() - 1)
    if (date >= lastWeekStart && date <= lastWeekEnd) {
        return '上周'
    }

    // 本月
    if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
        return `${date.getMonth() + 1}月${date.getDate()}日`
    }

    // 更早
    return '更早'

}