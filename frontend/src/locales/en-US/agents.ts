export default {
  // ── 页面 (AgentsPage.vue) ──
  page: {
    title: 'Agents',
    // 智能体操作
    deleteAgentTitle: 'Confirm Deletion',
    deleteAgentConfirm: 'Are you sure you want to delete agent "{name}"? This action cannot be undone.',
    agentDeleteSuccess: 'Agent deleted successfully',
    deleteFailed: 'Deletion failed',
    loadFailed: 'Failed to load agent list',
  },

  // ── 列表标签页 (AgentListTab.vue) ──
  list: {
    create: 'New Agent',
    import: 'Import',
    docs: 'Documentation',
    noDescription: 'No description',
    useAgent: 'Use this agent',
    agentSettings: 'Agent Settings',
    empty: 'No agents',
    emptyHint: 'Click the button above to create your first agent',
    importSuccess: 'Successfully imported {count} agents',
    importPartial: '{count} files failed to import',
    importFailed: 'Import failed',
  },

  // ── 智能体弹窗 (AgentModal.vue) ──
  modal: {
    editTitle: 'Edit Agent',
    createTitle: 'New Agent',
    applyAll: 'Apply All Settings',
    saveSuccess: 'Agent updated successfully',
    saveFailed: 'Failed to save agent',
  },

  // ── 智能体设置面板 (AgentSettingPanel.vue) ──
  setting: {
    loading: 'Loading agent settings...',
    // 侧边栏
    groupBasic: 'Basic Configuration',
    groupTools: 'Tools & Capabilities',
    navBasic: 'Basics',
    navPrompt: 'Prompt',
    navLocalTools: 'Toolkits',
    navMcpTools: 'MCP Tools',
    navSkills: 'Skills',
    navSubAgents: 'Sub-agents',
    // 基础设置
    avatarTitle: 'Agent Avatar',
    avatarOptional: '(Optional)',
    avatarHint: 'Click the avatar to upload a new image',
    titleLabel: 'Agent Name',
    titleHint: 'Display name of the agent, shown in the conversation list. Renaming does not change the storage directory (id)',
    titlePlaceholder: 'Enter agent name',
    titleRequired: 'Please enter a agent name',
    titleLength: 'Name length must be between 2 and 20 agents',
    idLabel: 'Agent ID',
    idHint: 'Storage directory name, fixed after creation; renaming the agent does not change it',
    idOptional: 'optional',
    idCreateHint: 'Directory name. Lowercase letters, digits and hyphens only (e.g. code-analyst); leave blank to auto-generate agent-<uuid>',
    idPlaceholder: 'e.g. code-analyst',
    idInvalid: 'Only lowercase letters, digits and hyphens are allowed, and it must start with a letter or digit',
    descLabel: 'Agent Description',
    descOptional: '(Optional)',
    descHint: 'Briefly describe the purpose, features, or background of the agent',
    descPlaceholder: 'Enter agent description',
    modelLabel: 'Model Selection',
    modelOptional: '(Optional)',
    modelHint: 'Specify a dedicated AI model for this agent. Leave empty to select a model when creating a new session. Changing the model will not affect already created sessions.',
    modelPlaceholder: 'Select a model',
    modelUseDefault: 'Not specified (choose when creating a session)',
    // 记忆与压缩
    compressionTier: 'Compression Strategy',
    compressionTierHint: 'Built-in presets that decide the trigger threshold, retention, and whether summarization runs',
    compressionTierPlaceholder: 'Select compression strategy',
    tierOff: 'Compression Off',
    tierOffDesc: 'Compression Off - no trimming or summaries, full history is kept',
    tierConservative: 'Conservative',
    tierConservativeDesc: 'Conservative - triggers at 90%, keeps 40%',
    tierAggressive: 'Aggressive',
    tierAggressiveDesc: 'Aggressive - triggers at 90%, keeps 20%',
    // 提示词
    systemPromptLabel: 'System Prompt (Agent Settings)',
    systemPromptPlaceholder: 'Enter detailed settings',
    // 本地工具
    toolToggle: 'Feature Toggles',
    newPluginLabel: 'New Plugin',
    autoEnable: 'Auto Enable',
    keepDisabled: 'Keep Disabled',
    noLocalTools: 'No local tools available',
    noLocalToolsHint: 'Please enable tools in "Plugins > Local Tools" first',
    kitSource: 'Source: {plugin}',
    // MCP 工具
    newMcpLabel: 'New MCP',
    mcpRunning: 'Running',
    mcpNotRunning: 'Not Running',
    noMcpServers: 'No running MCP servers',
    availableTools: 'Available tools: {count}',
    // Skills
    newSkillLabel: 'New Skill',
    loadingSkills: 'Loading...',
    noSkills: 'No Skills available',
    noSkillsHint: 'Please install skills in "Plugins > Skills" first',
    sourceBuiltin: 'Built-in',
    // 子代理
    loadingAgents: 'Loading...',
    noAgents: 'No sub-agents available',
    noAgentsHint: 'Please create other agents first',
    // 提示
    tipTitle: 'Tips',
    tip1: '• Compression Strategy: presets decide the trigger threshold, retention, and whether summarization runs',
    tip2: '• Long-term memory is maintained by the model during the conversation; the memory index is injected into context',
    tip3: '• With compression off, you can still trigger a manual compression from the session panel',
    // 通用
    noDescription: 'No description',
    enable: 'Enable',
    disable: 'Disable',
    toolSwitchOn: 'Enabled',
    loadLocalToolsFailed: 'Failed to load local tools',
    loadModelsFailed: 'Failed to load model list',
    // 记忆类型选项
    memorySlidingWindow: 'Sliding Window',
    memorySummaryAugmented: 'Summary Augmented',
    memorySlidingWindowWithRag: 'Sliding Window + Memory Retrieval',
    memoryless: 'No Memory',
    // 通用子代理
    genericAgentTitle: 'Generic Sub-agent',
    genericAgentDesc: 'A sub-agent for general tasks. No specific agent settings required. Permissions inherit from the parent agent.',
  },
}
