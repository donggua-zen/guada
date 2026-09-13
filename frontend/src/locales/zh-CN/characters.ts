export default {
  // ── 页面 (CharactersPage.vue) ──
  page: {
    title: '助手',
    // 角色操作
    deleteCharacterTitle: '确认删除',
    deleteCharacterConfirm: '确定要删除助手「{name}」吗？此操作不可撤销。',
    characterDeleteSuccess: '助手删除成功',
    deleteFailed: '删除失败',
    loadFailed: '获取助手列表失败',
  },

  // ── 列表标签页 (CharacterListTab.vue) ──
  list: {
    create: '新建助手',
    import: '导入',
    docs: '使用说明',
    noDescription: '暂无描述',
    useCharacter: '使用此角色',
    characterSettings: '角色设置',
    empty: '暂无助手',
    emptyHint: '点击上方按钮创建第一个助手',
    importSuccess: '成功导入 {count} 个助手',
    importPartial: '{count} 个文件导入失败',
    importFailed: '导入失败',
  },

  // ── 角色弹窗 (CharacterModal.vue) ──
  modal: {
    editTitle: '编辑角色',
    createTitle: '新建角色',
    applyAll: '应用全部设置',
    saveSuccess: '角色更新成功',
    saveFailed: '角色保存失败',
  },

  // ── 角色设置面板 (CharacterSettingPanel.vue) ──
  setting: {
    loading: '正在加载角色设置...',
    // 侧边栏
    groupBasic: '基础配置',
    groupTools: '工具与能力',
    navBasic: '基础',
    navPrompt: '提示词',
    navLocalTools: '工具包',
    navMcpTools: 'MCP 工具',
    navSkills: 'Skills',
    navSubAgents: '子代理',
    // 基础设置
    avatarTitle: '角色头像',
    avatarOptional: '(可选)',
    avatarHint: '点击头像可以更换新的头像，支持上传图片文件',
    titleLabel: '角色名称',
    titleHint: '助手的显示名称，在对话列表中展示。修改名称不会改变助手的存储目录（id）',
    titlePlaceholder: '请输入角色名称',
    titleRequired: '请输入角色名称',
    titleLength: '名称长度在2-20个字符之间',
    idLabel: '助手 ID',
    idHint: '存储目录名，创建后固定不变；重命名助手不会改变它',
    descLabel: '角色描述',
    descOptional: '(可选)',
    descHint: '简要描述助手的用途、特点或背景信息',
    descPlaceholder: '请输入角色描述',
    modelLabel: '模型选择',
    modelOptional: '(可选)',
    modelHint: '为此助手指定专用的 AI 模型，留空则使用默认模型。修改模型配置不会同步修改已经创建的会话。',
    modelPlaceholder: '请选择模型',
    modelUseDefault: '使用默认模型',
    // 记忆与压缩
    compressionTier: '压缩策略',
    compressionTierHint: '内置档位，同时决定触发时机、保留比例与摘要方式',
    compressionTierPlaceholder: '请选择压缩策略',
    tierOff: '关闭压缩',
    tierOffDesc: '关闭压缩 - 不裁剪、不摘要，完整保留全部历史',
    tierConservative: '保守',
    tierConservativeDesc: '保守 - 90% 触发、保留 40%，摘要前先同步记忆',
    tierAggressive: '激进',
    tierAggressiveDesc: '激进 - 90% 触发、保留 20%，摘要前先同步记忆',
    // 提示词
    systemPromptLabel: '系统系提示(角色设定)',
    systemPromptPlaceholder: '请输入详细设定',
    // 本地工具
    toolToggle: '功能开关',
    newPluginLabel: '新增插件',
    autoEnable: '自动启用',
    keepDisabled: '保持禁用',
    noLocalTools: '暂无可用的本地工具',
    noLocalToolsHint: '请先到"插件 > 本地工具"中启用工具',
    kitSource: '来源：{plugin}',
    // MCP 工具
    newMcpLabel: '新增MCP',
    mcpRunning: '运行中',
    mcpNotRunning: '未运行',
    noMcpServers: '暂无已启动的 MCP 服务器',
    availableTools: '可用工具：{count} 个',
    // Skills
    newSkillLabel: '新增技能',
    loadingSkills: '加载中...',
    noSkills: '暂无可用的 Skills',
    noSkillsHint: '请先到"插件 > Skills"中安装技能',
    sourceBuiltin: '内置',
    // 子代理
    loadingAgents: '加载中...',
    noAgents: '暂无可用的子代理',
    noAgentsHint: '请先创建其他助手',
    // 提示
    tipTitle: '提示',
    tip1: '• 压缩策略：档位同时决定触发时机、保留比例与摘要方式',
    tip2: '• 摘要前会先执行记忆同步，将关键信息保存到记忆文件，防止压缩丢失',
    tip3: '• 关闭压缩后仍可在会话面板手动触发一次压缩',
    // 通用
    noDescription: '暂无描述',
    enable: '启用',
    disable: '禁用',
    toolSwitchOn: '启动',
    loadLocalToolsFailed: '加载本地工具失败',
    loadModelsFailed: '获取模型列表失败',
    // 记忆类型选项
    memorySlidingWindow: '滑动窗口',
    memorySummaryAugmented: '摘要增强',
    memorySlidingWindowWithRag: '滑动窗口+记忆检索',
    memoryless: '无记忆',
    // 通用子代理
    genericAgentTitle: '通用子代理',
    genericAgentDesc: '适用于通用任务的子代理，无需特定角色设定，权限继承父角色设置',
  },
}
