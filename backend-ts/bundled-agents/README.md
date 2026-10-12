# bundled-agents — 内置默认助手模板

本目录是**随包发布的只读默认助手模板**，与 `bundled-providers/` 的定位一致：
只作为默认助手的来源，不作为运行时可写数据。

- 每个子目录 = 一个助手，**目录名即 id**
- **id 必须是 ASCII slug**：`^[a-z0-9][a-z0-9-]*$`（小写字母 / 数字 / 连字符），**禁止中文与大写**。
  显示名写在 `AGENT.md` 的 `name` 字段，可与 id 完全不同（如 id `assistant-agent` ↔ name「智能助手」）
- 目录内 `AGENT.md` = 定义（YAML frontmatter + Markdown 正文即 systemPrompt）
- **正文（systemPrompt）一律英文**：LLM 侧提示词统一英文，与插件 `description` / `inputSchema`
  保持英文同一条约定（见 `plugins/i18n/nls.service.ts` 的头注释）；`name` / `description`
  是展示字段（`description` 另会注入子代理候选列表），可中文
- 目录内 `avatar.<ext>` = 可选头像

用户的助手存放在 `<AGENTS_DATA_DIR>/`（Electron 下为 `~/.guada/agents/`）。
启动时，若用户目录缺少某个默认 id 且该 id 无删除墓碑，会从本目录**复制补种**；
已存在的助手**绝不被覆盖**，因此在 UI 里改过的默认助手不会被升级冲掉。

在 UI 中删除助手会写入墓碑（`.tombstones.json`）并移入 `.trash/`，
该助手不会因补种而复活。

**`assistant-agent` 的两条强约束**（`agent-file.mapper.ts` 的 `DEFAULT_AGENT_ID`）：

1. **恒排列表第一**：`AgentFileStore.listAgents` 排序时钉死在首位，
   其余助手按创建时间升序。顺带让「新建会话回退 agents[0]」的默认选中确定性地落在它身上。
2. **禁止删除**：HTTP 边界（`AgentService.deleteAgent`）返回 400，
   store 层另有防御性拦截。因此它**永远不会进墓碑**，补种也永远有效。

**所有智能体的 id 一旦创建不可修改**：id 即目录名，改名会断
`session.agentId` / `bot.defaultAgentId` / 调度任务 / 白名单的全部引用。
`updateAgent` 对请求体中与路径不一致的 `id` 返回 400。

字段说明见 `docs/design/character-file-format.md`。
