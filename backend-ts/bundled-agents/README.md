# bundled-agents — 内置默认助手模板

本目录是**随包发布的只读默认助手模板**，与 `bundled-providers/` 的定位一致：
只作为默认助手的来源，不作为运行时可写数据。

- 每个子目录 = 一个助手，**目录名即 id**
- 目录内 `AGENT.md` = 定义（YAML frontmatter + Markdown 正文即 systemPrompt）
- 目录内 `avatar.<ext>` = 可选头像

用户的助手存放在 `<AGENTS_DATA_DIR>/`（Electron 下为 `~/.guada/agents/`）。
启动时，若用户目录缺少某个默认 id 且该 id 无删除墓碑，会从本目录**复制补种**；
已存在的助手**绝不被覆盖**，因此在 UI 里改过的默认助手不会被升级冲掉。

在 UI 中删除助手会写入墓碑（`.tombstones.json`）并移入 `.trash/`，
该助手不会因补种而复活。

字段说明见 `docs/design/character-file-format.md`。
