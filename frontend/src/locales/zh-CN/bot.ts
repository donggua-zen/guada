export default {
  // ── 共用状态 ──
  status: {
    stopped: '已停止',
    error: '错误',
    connecting: '连接中',
    running: '运行中',
    unknown: '未知',
  },

  // ── 平台名称 ──
  platform: {
    qq: 'QQ',
    wechat: '微信',
    'wechat-personal': '微信个人号',
    discord: 'Discord',
    lark: '飞书',
    wecom: '企微',
    unknown: '未知',
  },

  // ── Bot 管理页 (BotManagementPage.vue) ──
  management: {
    title: '机器人管理',
    subtitle: '配置和管理聊天平台机器人，支持 QQ、微信、Discord 等多平台接入。',
    create: '新建机器人',
    docs: '使用说明',
    empty: '暂无机器人',
    emptyHint: '点击上方按钮创建第一个机器人',
    deleteTitle: '删除确认',
    deleteConfirm: '确定要删除机器人 "{name}" 吗？此操作不可恢复。',
  },

  // ── Bot 中心页 (BotCenterPage.vue) ──
  center: {
    title: '机器人',
    tabManagement: '机器人管理',
    tabSessions: '对话数据',
  },

  // ── Bot 卡片 (BotCard.vue) ──
  card: {
    qrCode: '二维码',
    edit: '编辑',
    delete: '删除',
    enable: '启用',
    disable: '禁用',
    // 二维码弹窗
    qrTitle: '微信扫码登录',
    qrReadyHint: '请使用微信扫描上方二维码完成登录',
    refreshQr: '刷新二维码',
    logout: '退出登录',
    qrUnavailable: '暂无二维码，请启动机器人后重试',
    getQrFailed: '获取二维码失败',
    logoutFailed: '退出登录失败',
  },

  // ── Bot 弹窗 (BotModal.vue) ──
  modal: {
    editTitle: '编辑机器人',
    createTitle: '创建机器人',
    // 平台选择
    platformLabel: '选择平台',
    platformPlaceholder: '请选择平台',
    configDocBtn: '查看配置教程',
    configDocBtnWith: '查看{name}配置教程',
    // 基本信息
    nameLabel: '机器人名称',
    namePlaceholder: '请输入机器人名称',
    nameRequired: '请输入机器人名称',
    nameLength: '长度在 2 到 50 个字符',
    characterLabel: '默认角色',
    characterPlaceholder: '请选择默认角色',
    characterRequired: '请选择默认角色',
    characterHint: '机器人接收消息后使用该角色进行对话',
    modelLabel: '模型选择',
    modelPlaceholder: '继承自角色/全局设置',
    modelHint: '不选择则使用角色的默认模型，如果角色未设置则使用全局默认模型',
    thinkingLabel: '思考强度',
    thinkingPlaceholder: '不设置',
    thinkingHint: '设置后对该机器人的所有会话生效',
    kbLabel: '引用知识库',
    kbPlaceholder: '请选择知识库（可多选）',
    kbHint: 'AI回复时会引用这些知识库的内容',
    // 平台配置
    platformConfig: '平台配置',
    // 高级配置
    advanced: '高级配置',
    advancedOptional: '可选',
    reconnectLabel: '启用重连',
    maxRetries: '最大重试次数',
    retryInterval: '重试间隔(ms)',
    // 自动启动
    autoStartLabel: '自动启动',
    autoStartHint: '创建后立即启动机器人',
    // 按钮
    save: '保存',
    create: '创建',
    // 错误提示
    loadCharactersFailed: '获取角色列表失败',
    loadKbFailed: '获取知识库列表失败',
    loadModelsFailed: '获取模型列表失败',
    platformRequired: '请选择平台',
    fieldRequired: '请输入{label}',
  },

  // ── 会话列表 (BotSessionsList.vue) ──
  sessions: {
    title: '对话数据',
    subtitle: '查看和管理机器人与用户的对话记录。',
    allSessions: '全部会话',
    loading: '加载中...',
    colTitle: '会话标题',
    unnamedSession: '未命名会话',
    colPlatform: '平台',
    colBot: '关联 Bot',
    unknownBot: '未知 Bot',
    colLastActive: '最后活跃',
    colActions: '操作',
    viewChat: '查看对话',
    clearMessages: '清空记录',
    delete: '删除',
    empty: '暂无 Bot 会话',
    emptyHint: '启动机器人后，与机器人的对话将显示在这里',
    // 清空确认
    clearTitle: '清空确认',
    clearConfirm: '确定要清空会话 "{title}" 的所有聊天记录吗？会话本身将保留，但所有消息将被永久删除，且不可恢复。',
    clearSuccess: '聊天记录已清空',
    clearFailed: '清空失败',
    // 删除确认
    deleteTitle: '删除确认',
    deleteConfirm: '确定要删除会话 "{title}" 吗？此操作将删除该会话的所有消息记录，且不可恢复。',
    deleteSuccess: '会话已删除',
    deleteFailed: '删除失败',
    loadFailed: '加载会话失败',
    // 时间格式
    justNow: '刚刚',
    minutesAgo: '{n}分钟前',
    hoursAgo: '{n}小时前',
  },

  // ── 会话详情弹窗 (BotSessionDialog.vue) ──
  sessionDialog: {
    title: '会话详情',
    loading: '加载中...',
    empty: '暂无消息',
    loadFailed: '加载消息失败',
    // 删除消息确认
    deleteUserMsg: '确定要删除这条提问吗?对应的回答也会被删除。此操作不可撤销。',
    deleteAssistantMsg: '确定要删除这条回答吗?此操作不可撤销。',
    deleteTitle: '删除消息',
    deleteSuccess: '消息已删除',
    deleteFailed: '删除失败',
    editNotImplemented: '编辑功能待实现',
  },
}
