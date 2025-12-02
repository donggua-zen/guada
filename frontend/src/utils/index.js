/**
 * 格式化时间显示
 * @param {string} dateString - 日期字符串
 * @param {string} style - 显示样式，默认为'firendly'友好显示，其他值则显示年月日时分
 * @returns {string} 格式化后的时间字符串
 */
export const formatTime = (dateString, style = 'friendly') => {

    if (!dateString) return ''

    const date = new Date(dateString)
    const dateTime = date.getTime()
    if (isNaN(dateTime)) return '' // 防止无效日期

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const dateCompare = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

    if (style !== 'friendly') {
        // 返回年月时分
        return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    }

    // 计算相差天数
    const diffDays = Math.floor((todayStart - dateCompare) / (24 * 60 * 60 * 1000))

    // 当天
    if (diffDays === 0) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }

    // 昨天
    if (diffDays === 1) {
        return '昨天'
    }

    // 前天
    if (diffDays === 2) {
        return '前天'
    }

    // 本周（周一为起始）
    const day = date.getDay()
    const weekStart = todayStart - (now.getDay() === 0 ? 6 : now.getDay() - 1) * 24 * 60 * 60 * 1000

    if (dateCompare >= weekStart) {
        const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        return weekDays[day]
    }

    // 上周
    const lastWeekStart = weekStart - 7 * 24 * 60 * 60 * 1000
    if (dateCompare >= lastWeekStart && dateCompare < weekStart) {
        return '上周'
    }

    // 本月
    if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
        return `${date.getMonth() + 1}月${date.getDate()}日`
    }

    // 更早
    return '更早'

}