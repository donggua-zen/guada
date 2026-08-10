export default {
  // Phase 5 subagent will populate this file (session/search/group related)

  // ── bot store ──
  bot: {
    loadPlatformsFailed: '加载平台列表失败',
    loadBotsFailed: '加载机器人列表失败',
    createSuccess: '机器人创建成功',
    createFailed: '创建机器人失败',
    updateSuccess: '机器人更新成功',
    updateFailed: '更新机器人失败',
    deleteSuccess: '机器人删除成功',
    deleteFailed: '删除机器人失败',
    starting: '机器人启动中...',
    startFailed: '启动机器人失败',
    stopped: '机器人已停止',
    stopFailed: '停止机器人失败',
    restarting: '机器人重启中...',
    restartFailed: '重启机器人失败',
  },

  // ── popup ──
  popup: {
    inputPlaceholder: '请输入内容',
    contentRequired: '内容不能为空',
    editTitle: '编辑内容',
    processing: '处理中...',
  },

  // ── context menu manager ──
  contextMenu: {
    copy: '复制',
    paste: '粘贴',
    cut: '剪切',
    selectAll: '全选',
    openInNewWindow: '在新窗口打开',
    copyLink: '复制链接地址',
    saveImage: '保存图片',
    refresh: '刷新',
  },

  // ── workspace preview ──
  workspace: {
    selectLinkMode: '选择链接打开方式',
    internalBrowser: '内置浏览器',
    externalBrowser: '外部浏览器',
  },

  // ── format time ──
  time: {
    yesterday: '昨天',
    dayBeforeYesterday: '前天',
    sunday: '周日',
    monday: '周一',
    tuesday: '周二',
    wednesday: '周三',
    thursday: '周四',
    friday: '周五',
    saturday: '周六',
    lastWeek: '上周',
    monthDay: '{month}月{day}日',
    earlier: '更早',
  },

  // ── api service ──
  api: {
    cannotConnect: '无法连接到后端服务，请确保应用已完全启动',
    requestFailed: '请求失败',
    responseFailed: '获取响应失败：{status}',
    sendFailed: '发送失败: {status}',
  },

  // ── 会话搜索 (SessionSearchDialog.vue) ──
  search: {
    placeholder: '搜索会话标题或内容...',
    searching: '搜索中...',
    searchFailed: '搜索会话失败',
    contentMatch: '内容',
    noResults: '未找到匹配的会话',
    initial: '输入关键词搜索会话',
    loadMore: '加载更多',
    loadingMore: '加载中...',
    ungrouped: '任务列表',
    timeNow: 'now',
    timeMin: '{n}min',
    timeHour: '{n}h',
    timeDay: '{n}d',
    timeMonth: '{n}m',
    timeEarlier: '更早',
  },

  // ── 会话分组管理 (SessionGroupManageDialog.vue) ──
  group: {
    title: '分组管理',
    newPlaceholder: '输入新分组名称',
    create: '新建',
    empty: '暂无自定义分组',
    save: '保存',
    cancel: '取消',
    deleteTitle: '删除分组',
    deleteConfirm: '确定要删除分组 "{name}" 吗？该分组下的会话将自动归入未分组。',
    createSuccess: '分组创建成功',
    createFailed: '分组创建失败',
    updateSuccess: '分组名称已更新',
    updateFailed: '更新失败',
    deleteSuccess: '分组已删除',
    deleteFailed: '删除失败',
    nameEmpty: '分组名称不能为空',
    reorderSuccess: '分组顺序已更新',
    reorderFailed: '排序更新失败',
    tipsTitle: '提示：',
    tip1: '拖拽可调整分组顺序',
    tip2: '删除分组后，该分组下的会话将自动归入"任务列表"',
    tip3: '"任务列表"为默认分组，不可删除或重命名',
  },
}