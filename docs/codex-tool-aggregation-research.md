# Codex 工具调用聚合逻辑研究

> 研究对象：OpenAI Codex 桌面版（闭源 Electron）与 `openai/codex` 开源 TUI（Apache-2.0）
> 对照对象：本项目 `frontend/src/utils/messageUtils.ts` + `components/chat/groupExpansion.ts` + `components/chat/TurnItem.vue`
> 结论定位：**调研 + 可落地建议，本轮不改前端代码**
> 研究日期：2026-10-28

---

## 0. 结论摘要

Codex 在两套 UI 里采用了同一种设计哲学：**默认只给一行语义摘要，细节按需展开**。但两套实现的聚合粒度不同：

1. **桌面版是两层聚合**：
   - Turn 级：整个工作过程可以折叠成一条 `Worked for {time}` 分隔条，收起时只显示耗时/`{count} previous messages`/被自动审查拒绝的动作数。
   - Activity group 级：连续的“可分组”工具项（exec / patch / mcp-tool-call / web-search / dynamic-tool-call）合成一个活动组；组标题在运行时显示**最近一个进行中的动作**（Reading / Searching / Listing / Running command / Ran command），结束后显示**语义化 summary parts**（探索、文件变更、命令、网页搜索、MCP 来源、加载的工具等）。组体默认收起，展开后限高滚动。
2. **开源 TUI 是语义分组**：
   - 只有连续的**只读探索命令**（read / list / search）会合成 `Exploring` / `Explored` 组；非只读命令单独成行。
   - 组内按 `Read`（连续成功读取合并文件名）、`List`、`Search`、`Run` 展示；失败命令保留在组内并追加退出码。
   - 思考内容作为“组内 detail”保留，不打断紧凑分组；历史分页把组切断时会按 item ID 邻接关系修复。
3. **我们当前**：
   - 分组边界是“连续 think/tool”，以 content 和独立渲染工具为分隔符；默认展开正在运行的最后一组，结束后收起。
   - 标题是“已执行 N 个步骤 / 正在执行的同类型工具聚合 / 参数摘要”，没有探索、变更、命令、网页、MCP 这类**语义分类**。
   - 组体没有高度上限（CSS 里 `max-height: 400px` 被注释掉），单步骤组会自动展开工具结果，长输出会直接撑高页面。

**最值得借鉴的三件事**：语义化摘要、组身份/历史修复的稳定性、长内容限高滚动。**不建议照搬**桌面版“所有活动组默认收起”——社区反馈已经把它当成痛点，而我们刚刚按需求改成“进行中默认展开”。

---

## 1. 研究对象、版本与证据边界

### 1.1 桌面版

- 包：`OpenAI.Codex 26.1023.6123.0`（MSIX）
- 安装路径：`C:\Program Files\WindowsApps\OpenAI.Codex_26.1023.6123.0_x64__2p2nqsd0c76g0\app`
- UI 载体：`app\resources\app.asar`，659,553,390 字节，22,333 个文件
- 形态：Electron 外壳 + Rust Codex core；UI 前端**闭源、minified、包内无 source map**
- 本轮只做**只读静态分析**：按 asar header 偏移读取指定 chunk，不整包解压、不运行应用、不做运行时观测
- **本机已安装该版本，因此没有下载安装包**；如需最新版，Windows 官方入口是 Microsoft Store（产品 ID `9PLM9XGG6VKS`），macOS/Linux 见 `openai.com/codex`

> 条款提示：对闭源客户端做静态分析可能触及 OpenAI 服务条款中的逆向工程限制。本报告只记录行为结论与 chunk 名称，不附带闭源代码片段，也不做二次分发。

### 1.2 开源 TUI

- 仓库：`https://github.com/openai/codex`，Apache-2.0
- 本地稀疏检出：`outputs/codex-src`（未跟踪）
- 版本：commit `26ad281fd1ca712e4f0c7920a6273cf18c961b8a`（2026-10-28）
- 重点目录：`codex-rs/tui/src/exec_cell/`、`history_cell/`、`thread_transcript/`

### 1.3 本项目基线

- `frontend/src/utils/messageUtils.ts:208-253`：`doGrouping`
- `frontend/src/components/chat/groupExpansion.ts:14-92`：展开覆盖、忙碌判定、标题阶段
- `frontend/src/components/chat/TurnItem.vue:313-332`、`:420-523`：分组展开与标题
- `frontend/src/utils/toolDisplay.ts:330-355`：独立渲染工具判定
- `frontend/src/components/chat/message-item/MessageToolCalls.vue:230-245`：行级展开

### 1.4 公开 UX 证据

- OpenAI 社区帖《Feature Request: Always expand Codex activity/tool logs》（2026-09-25）：
  > activity blocks such as Shell, Read, Search, and other tool calls are collapsed by default
  > I have to manually expand them one by one on both desktop and mobile
  回复（2026-10-21）：> I can't keep clicking every chevron.
- OpenAI 社区帖《Ran command no longer shows what it does》（2026-09-15）：
  > When Agent runs command, the exact commands being run is not displayed anymore
  > It should allow user to click (expand) the commands being run by the agent
- GitHub issue `openai/codex#37213`（2026-08-06，open）：桌面端不再直接显示执行的命令，需要点击展开。本轮直连 GitHub 超时，此条为检索结果摘要，未逐字核对原文。

### 1.5 证据分级

- **[观察]**：开源源码可直接读到；asar 中可直接读到字符串字面量与 import 图。
- **[推断]**：minified 控制流的语义还原（例如 `J` 标志、`startsGroup` 的触发时机）。
- **[未知]**：没有运行时观测，无法确认某些分支在真实 UI 中一定被触发；桌面版精确文案可能随版本变化。

---

## 2. 桌面版：三层聚合

### 2.1 Turn 级：`Worked for {time}`

相关 chunk：

- `/webview/assets/collapsed-turn-disclosure-eece0cb2b528.js`（4,414 B）
- `/webview/assets/worked-for-item-content-78646966229e.js`（4,196 B）

`worked-for-item-content` 是一个状态机，输入 `status`、`startedAtMs`、`completedAtMs`，输出一行标签：

| status | 文案 |
|---|---|
| `loading` | 骨架占位 |
| `unknown` | `Activity` |
| `paused` | `Paused` |
| `working` | 耗时 ≥1s：`Working for {time}`；否则 `Working` |
| `worked` | `Worked for {time}` |
| `stopped` | `You stopped after {time}` |

`collapsed-turn-disclosure` 把这一行做成可点击的 disclosure：

- 有 `workedForItem` 时显示上面的状态标签；
- 否则有 `workedDurationMs` 时显示 `Worked for {time}`；
- 否则显示 `{count} previous messages`；
- 右侧可显示被自动审查拒绝的动作数（`{count} denied action(s)`），点击该部分也会展开/收起 turn 的活动；
- 带 `aria-expanded` 与箭头旋转；
- 下方有一条分隔线，语义是“agent activity 与最终回答之间的分隔”。

**聚合含义**：整个中间过程（思考 + 工具 + 审批）可以被压成一条耗时摘要，最终回答保持独立。这是“turn 级折叠”，不是“工具分组”。

### 2.2 Activity group 级：可分组元数据 + 渲染分组

相关 chunk：

- `/webview/assets/agent-activity-item-939c4776206c.js`（23,395 B）
- `/webview/assets/split-items-into-render-groups-195e10055074.js`（6,980 B）
- `/webview/assets/inline-followup-markdown-38a6bf24a857.js`（23,190 B，内含分组构建与摘要聚合函数）
- `/webview/assets/subagent-activity-chip-group-3c945b5e2db4.js`（453,283 B，内含分组渲染组件）
- `/webview/assets/agent-activity-item-row-4e87dc89e455.js`（5,641 B）
- `/webview/assets/activity-row-39cace2a03b5.js`（1,684 B）

#### 2.2.1 每个 item 先被分类为 `groupable` / `standalone` / 不渲染

`agent-activity-item` 里的分类函数（minified 名 `hr`）返回 `{ item, grouping }`：

| item 类型 | grouping |
|---|---|
| `exec`、`patch` | `groupable`；部分情况强制 `standalone`（例如审批/用户 shell 等条件） |
| `mcp-tool-call` | `groupable`；MCP App / 需要独立展示时 `standalone` |
| `web-search` | 有 query 时 `groupable`，空 query 不渲染 |
| `dynamic-tool-call` | 按 renderer 元数据：`hiddenInConversation` 不渲染；`standaloneInConversation` 独立；否则 `groupable` |
| `automatic-approval-review` | `approved` 不渲染；`inProgress` 可分组；`denied` / `timedOut` / `aborted` 独立 |
| `assistant-message`、`subagent-activity`、`worked-for`、`user-message`、图片、系统错误等 | `standalone` |
| `reasoning`、`todo-list`、`proposed-plan`、`turn-diff`、`userInput` 等 | 不进入这个渲染层（`null`） |

**关键点**：分组不是按工具名硬编码，而是每个工具项带 `grouping` 元数据；`reasoning` 被排除在渲染分组之外，因此**思考不会打断工具组**，这一点与 TUI 一致。

#### 2.2.2 连续 `groupable` 合并，`startsGroup` 强制开新组

`split-items-into-render-groups` 的返回结构里包含 `toolGroupStartItems`（一个 Set）。它的标记逻辑（[推断]）：

- 遇到 assistant commentary 时置 `J = true`；
- 之后第一个 `grouping === 'groupable'` 的 item，如果它和下一个 item 不是特殊配对（`gr`），就加入 `toolGroupStartItems` 并复位 `J`；
- 特殊配对 `gr` 处理两种“当前项应让位给下一项”的情况：exec + 带可视化活动的 patch，以及读取 skill 定义文件的 exec。

`inline-followup-markdown` 里的分组构建函数（minified 名 `F`）：

- 顺序遍历 `{ activityItem, startsGroup }`；
- `groupable` 连续累加到当前组；
- `startsGroup === true` 时先 flush 当前组并重置，从而在 commentary 之后开新组；
- `standalone` 项 flush 当前组并单独渲染；
- 组 key 取**第一个 item 的稳定 id**：`agent-activity-group:${I(first)}`，`I()` 优先用 `searchItemId` / `id` / `callId` / `requestId` / `handoffId`。

这与我们 `process-${currentProcess[0].id}` 的“首项锚定”思路一致。

#### 2.2.3 组标题：运行时一行活动标签，结束后语义 summary

`subagent-activity-chip-group` 里的分组组件（minified 名 `aj`）先计算组状态（`L_`）：

- 如果这是最新可见组、回合仍在进行、且活动切片未关闭：
  - 若当前处于“探索”状态，从后往前找最后一个探索项作为 active；
  - 否则从后往前找最后一个未完成项；
  - 找不到则显示 `Thinking`；
- 否则进入 `summary`（已完成）状态。

组标题 `cj` 分三种：

1. **active**：调用 `active-tool-activity-label`，一行显示最近一个进行中的 exec 动作；
2. **thinking**：显示 `Thinking`；
3. **summary**：显示 `completedHeader.summaryParts`，没有 parts 时回退到 `Worked`。

`summaryParts` 由 `inline-followup-markdown` 的 `ke` 构建，按语义分类而不是按“步骤数”：

- `mcp-sources`：MCP 来源/连接器
- `loaded-tools`：加载的工具数（含 skill 定义读取）
- `unnamed-mcp-calls`：没有来源名的 MCP 调用数
- `file-changes`：创建/编辑/删除的文件数
- `stopped-file-creation`：被中断的创建数
- `exploration`：有读文件 / 搜索 / 列目录时出现（不直接带数字，渲染时映射为探索摘要）
- `visualization`：可视化活动的创建/更新
- `commands`：命令数
- `web-search`：网页搜索数
- `codex-tool-call` / `dynamic-tool-call`：具体工具项

探索聚合函数 `Se` 会分别统计：

- 读取路径（去重，分完成/进行中）
- “loaded tool” 路径（skill 定义类读取）
- 搜索次数（完成/进行中）
- 列目录次数（完成/进行中）
- 失败/拒绝的自动审查

**结论**：桌面版的组标题是一句“做了什么”的语义摘要，而不是“执行了几个步骤”。这是它信息密度高的核心原因。

#### 2.2.4 默认收起 + 限高滚动

分组折叠组件（minified 名 `Kv`）：

- `defaultExpanded` 未传时默认 **false**；
- 初始状态：可展开且 `defaultExpanded` 为 true 才展开；否则 `collapsed`；
- 对于“最新可见 + 头部进行中 + 活动切片未关闭”的组，初始状态是 `closing`（带一次收起动画）；
- 展开后组体是 `max-h-56`（14rem）的纵向滚动容器；
- active 摘要的更新有约 1 秒的节流（`deferred`），避免流式期间标题高频抖动。

这与社区帖的描述一致：Shell/Read/Search 等活动块默认收起，需要逐个点开。

### 2.3 活跃工具标签

`/webview/assets/active-tool-activity-label-682b84df8592.js` 的逻辑：

- 从 items 末尾往前扫描 `exec`；
- 第一轮只找进行中的（`executionStatus !== 'interrupted' && !parsedCmd.isFinished`），找不到再找已完成的；
- 返回 `{ activityKey: callId, icon, message, values }`；
- 分类文案：
  - `read` → `Reading {target}`；skill 定义 → `Reading {skillName} skill`；内部知识 → `Reading Internal Knowledge`
  - `search` → `Searching files in {folder}` / `Searching for {query}` / `Searching files`
  - `list_files` → `Listing files in {folder}` / `Listing files`
  - `format` / `lint` / `noop` / `test` / `unknown` → `Running {command}` / `Ran {command}` / `Stopped {command}`
  - 创建/更新类命令 → `Creating...` / `Updating...` + `edit-files` 图标

### 2.4 子代理与 MCP 面

- `subagent-activity-chip-group` 有独立的 chip 组聚合；
- `mcp-tool-activity-label` 有独立的 MCP 工具标签/呈现；
- MCP App 在分类阶段被强制 `standalone`，不并入普通工具组。

### 2.5 证据边界

- 以上控制流来自 minified bundle 的静态阅读，函数名是压缩后的单字母/双字母名；本文用行为描述而非代码复述。
- 没有 source map，无法确认每一处条件在运行时都可达；尤其是 `startsGroup` 与 `gr` 特殊配对的精确触发频率。
- 未运行桌面版，未做 DOM/CDP 观测；默认展开状态来自组件初始值与社区反馈的交叉印证。

---

## 3. 开源 TUI：语义分组算法

TUI 的实现是 Apache-2.0，可直接读到完整逻辑，是本次最可靠的算法参照。

### 3.1 `ExecCell`：单条命令或“探索组”

`codex-rs/tui/src/exec_cell/model.rs`：

- `ExecCell` 内部是 `ActivityGroup<ExecCall>`（calls + details）。
- `is_exploring_call` 的判定：来源不是 `UserShell`、`parsed` 非空、且所有解析结果都是 `Read | ListFiles | Search`。
- `add_call` 只有在“当前 cell 已是探索 cell”且“新 call 也是探索调用”时才追加；否则调用方新建 cell。
- `should_flush`：非探索 cell 在所有 call 完成后 flush；探索 cell 保持开放，等待相邻调用，**即使中间有失败**。
- `complete_call` 按 `call_id` 从后往前匹配；匹配不到返回 false，调用方把它当成 orphan end 单独成条，避免错误地把两条记录合并。

### 3.2 渲染：`Exploring` / `Explored` + 组内明细

`exec_cell/render.rs`：

- 组头：进行中 `• Exploring`，结束 `• Explored`。
- 对连续的、全部为 `Read` 且退出码为 0 的调用，用 `group_len` 合并成一行 `Read file1, file2, ...`（文件名去重）。
- 其他情况逐条展示 `Read` / `List` / `Search` / `Run`。
- 非零退出码追加在明细行末尾；`Search` 的 exit 1 只标注退出码、不标红（表示“没有匹配”而不是失败）。
- 单条命令（非探索）：标题 `Running` / `Ran` / `You ran`；失败时 `Exited (status N)`；成功绿色圆点、失败红色圆点。

`exec_cell/compact.rs`：

- 紧凑预览最多保留 `DETAIL_PREVIEW_LINES = 3` 行输出尾部；
- 无输出时显示 `(no output)`；
- 只有确实隐藏了内容时才暴露 disclosure（`ActivityDisclosure::OutputLines(hidden)` / `Generic`）。

`exec_cell/transcript.rs`：

- 展开态按 `$ command` → 完整输出 → `✓/✗ (exit)` + duration 的时间顺序渲染；
- `group.details.lines_after(i + 1)` 把思考内容插回对应命令之后。

### 3.3 思考不打断组

`model.rs` 的 `append_reasoning`：探索组会把 reasoning 作为 detail 收进来，而不是新开 cell。这样紧凑视图仍然是一行 `Explored` + 明细，展开视图又能按时间顺序看到思考。

### 3.4 历史分页修复

`thread_transcript/exploration_groups.rs`：

- `join_exploration_groups` 只在“older 是探索组且未 flush、newer 也是探索组”时尝试合并；
- 用 `adjacent_activity_items` 按 persisted item ID 验证两者在 turn 内确实相邻；
- 验证时**跳过 Reasoning**，因为思考不是活动边界；
- 重建 `completed_group` 时跳过 Reasoning，只保留真正的 call；
- `prepend` 会平移 details 的位置，保留 live clock 和原始 terminal input。

`thread_transcript/activity_pages.rs` 进一步处理“older page 在 final reasoning page 之后才到”的边界情况：只重建已知的 completed calls，不根据相同 reasoning 文本推断邻接。

### 3.5 计算机操作与 MCP

`history_cell/computer_activity.rs`：

- 单独的 `ComputerActivityCell`，内部仍是 `ActivityGroup<McpToolCallCell>`；
- 组头：`Using computer · {count} actions`（进行中）/ `Used computer · {count} actions`（结束），可附加 `· {failures} failed`；
- 组体最多展示 3 条（超过 3 条时只展示 2 条 + `N more`），优先失败和有截图的动作；
- 思考不打断组；历史分组同样按 item ID 邻接修复。

`thread_transcript/tools.rs`：

- 普通 MCP 工具调用走独立的 `McpToolCallCell`，不并入 `ExecCell`；
- 历史回放中未完成的 command/MCP/agent tool 会退化成 `PlainHistoryCell` 状态行（如 `In progress at last update`），不伪造富卡片。

### 3.6 TUI 测试里能直接看到的期望

`chatwidget/tests/exec_flow.rs`：

- 一次 `ls` + 两次 `cat` → `• Explored`，明细 `List ls`、`Read foo.txt, bar.txt`；
- 失败命令仍在组内：`List missing (exit 1)` + 后续成功读取继续并入；
- 进行中 → `• Exploring`；结束后变为 `• Explored`；
- 单条 `ls` → `• Explored\n  └ List ls`。

---

## 4. 与本项目当前实现的对比

| 维度 | Codex 桌面版 | Codex 开源 TUI | 我们当前 |
|---|---|---|---|
| 聚合单位 | turn 级 `Worked for` + activity group | `ExecCell`（连续只读探索组） | 回合内 process 组（连续 think/tool） |
| 分组条件 | item 的 `grouping: groupable`，`startsGroup` 分界 | 语义判定：read/list/search 且非 UserShell | 结构判定：连续 think/tool；content 与独立工具分隔 |
| 组身份 | 首个 item 稳定 id | cell + `call_id` 路由 | `process-${首个 DisplayItem.id}` |
| 思考项 | 不进入渲染分组，不打断工具组 | 作为 detail 收入组，不打断 | think 与 tool 同组 |
| 助手文本 | standalone，打断组 | 新 cell / 打断 | content 分隔符，打断组 |
| 默认展开 | 组默认收起；turn 可整体收起 | 紧凑一行，详情按需展开 | 进行中最后一组默认展开，结束收起 |
| 标题内容 | 活跃动作一行标签 / 语义 summary parts | `Exploring/Explored` + Read/List/Search 明细 | 活跃状态 / 已执行 N 步 / 同类型聚合 / 参数摘要 |
| 长内容 | 组体 `max-h-56` 滚动 | 预览 3 行 + 展开 | 组体无高度上限，单步组自动展开 |
| 历史回放 | summary item ID + 分页 | `join_exploration_groups` 按 ID 修复 | `foldEvents` 全量重建 |
| 独立工具 | plan、denied approval、MCP App、图片等 | MCP 独立 cell；computer 单独组 | plan / subagent_spawn / workflow_run 独立组 |
| 失败表达 | 组头 summary 中的失败计数 / 拒绝数 | 退出码保留在组内；search exit 1 不标红 | outcome 红色图标 + 行内失败提示 |

### 我们当前的优点（不要丢）

- 展开状态有“用户显式覆盖 + 运行态缺省”的双层语义，结束自动收起、手动展开保留。
- 忙碌判定基于“未完成步骤”，而不是“组是否最后一组”，等待间隙不会误闪。
- 独立渲染工具（计划卡、子代理、workflow）已有明确分隔，不会被折进过程组。
- 行级展开与组级展开分离，组壳展开不会把多工具输出一次性摊开。

### 我们当前的缺口

1. **摘要缺语义**：`countToolSteps` 只给数字，用户看不出“读了几个文件、搜了几次、改了哪些文件”。
2. **长输出无上限**：`process-group__body-scroll` 的 `max-height: 400px` 被注释掉（`TurnItem.vue:940-944`）；单步骤组 auto-expand 时，长 diff/命令输出会把页面撑得很高。
3. **活跃标签粒度有限**：`getActiveStatusParts` 已能按同类型聚合（如“正在搜索 3 个网页”），但读/搜索/列目录缺少具体目标（文件名、查询词、目录）。
4. **历史分页修复未验证**：我们靠 `foldEvents` 全量重建，通常不会切断组；但如果将来做窗口化/分页渲染，需要一套 TUI 式的邻接修复。

---

## 5. 借鉴建议（按优先级）

> 以下是建议，不是本轮改动。

### P0：把“步骤数”升级为“语义摘要”

**做什么**：在组标题的 completed 分支，按工具类别汇总一行，例如：

- `已读 3 个文件、搜索 2 次、列出 1 个目录`
- `已修改 2 个文件（+42/−7）、执行 5 条命令`
- `已完成网页搜索 3 次、调用 MCP 工具 2 次`

保留 `已执行 N 个步骤` 作为无法分类时的兜底。

**依据**：桌面版 `summaryParts` / `Se` 的探索聚合、TUI 的 `Read/List/Search` 明细，都是按语义归类；纯步骤数在工具种类混合时信息量最低。

**成本**：中。需要在 `toolDisplay.ts` 增加类别映射（explore / execute / changes / web / mcp / agent），在 `TurnItem` 增加摘要拼装；插件自定义工具需要默认归类。
**风险**：中英文文案与复数/量词；类别判定要覆盖现有 renderer kind。
**涉及文件**：`toolDisplay.ts`、`TurnItem.vue`、`groupExpansion.ts`、两个 locale 文件。

建议的类别判定（尽量复用现有元数据，不新增按工具名的长分支）：

| 类别 | 判定来源 | 摘要示例 |
|---|---|---|
| 探索 | renderer kind 无 / icon 为 read、file、search、book；工具名含 read/glob/grep/list | 已读 3 个文件、搜索 2 次 |
| 命令 | renderer kind = `terminal` | 已执行 5 条命令 |
| 变更 | renderer kind = `diff` / `content` | 已修改 2 个文件（+42/−7） |
| 网页 | 工具名 `web_search` 或 icon = browser/window | 已搜索网页 3 次 |
| MCP | 工具名前缀 `mcp__` | 已调用 MCP 工具 2 次 |
| 子代理/工作流 | `subagent_*` / `workflow_*` | 已派发 2 个子任务 |
| 其他 | 以上都不命中 | 已执行 N 个步骤（兜底） |

判断顺序建议：独立渲染工具 → 变更/命令（renderer kind）→ MCP/子代理/工作流（名字前缀）→ 探索（icon/名字）→ 其他。这样新增工具只要带 renderer 或 icon 就能自动归类，不需要改分支。

### P0：给组体加限高滚动，避免长输出撑爆

**做什么**：恢复 `process-group__body-scroll` 的 `max-height`（例如 `min(60vh, 28rem)`），配合现有上下 16px 遮罩；组内当前展开的单个工具行仍可继续滚动查看。
**依据**：桌面版 `max-h-56`，TUI 只保留 3 行预览 + disclosure。我们目前无上限。
**成本**：低（主要是一行 CSS + 少量滚动锚定回归测试）。
**风险**：嵌套滚动（组体 + 页面）体验；需要确认“跟随底部”逻辑仍正常。
**涉及文件**：`TurnItem.vue` 样式段。

### P1：活跃标签补“具体目标”

**做什么**：在现有同类型聚合基础上，优先展示最近一个进行中工具的**具体目标**：

- read → 文件名
- search → 查询词或目录
- list_files → 目录
- shell → 命令摘要（截断）

**依据**：桌面版 `active-tool-activity-label` 从后往前找 in-progress，并输出 `Reading {target}` / `Searching for {query}` / `Running {command}`。
**成本**：低-中。`getActiveStatusParts` 已有 `ToolCall` 参数，可复用 `getArgsText` / renderer 解析。
**风险**：参数可能为空或很长，需要截断与回退。

### P1：把“运行中默认展开”与“长内容限高”组合使用

**做什么**：保留当前“进行中分组默认展开”的产品决策，但让组体限高滚动，这样既能看到当前动作，又不会被长输出淹没。
**依据**：Codex 两套 UI 都采用“紧凑摘要 + 按需详情”；我们选择了“进行中展开”，需要用限高来平衡。
**成本**：与 P0 的 CSS 改动合并。

### P2：历史分页/窗口化的组修复

**做什么**：如果未来做消息窗口化或事件分页渲染，按 toolCallId/稳定 item id 验证相邻关系，修复被分页切断的组；思考项不参与边界判定。
**依据**：TUI `join_exploration_groups` / `completed_group`；桌面版 `summary item IDs` 与分页。
**成本**：中；当前全量重建架构下优先级低。

### P2：子代理 / MCP 独立聚合面

**做什么**：评估把 MCP 工具调用从普通工具组中拆出，形成独立的 MCP 摘要/标签；子代理已有独立行，可进一步增强为 chip group。
**依据**：桌面版 `subagent-activity-chip-group` / `mcp-tool-activity-label`；TUI 的 `McpToolCallCell` 独立 cell。
**成本**：中-高；需要确认产品上是否需要。

---

## 6. 不建议照搬的点

1. **“所有活动组默认收起”**：桌面版这样做，但社区反馈明确把它当成痛点（`collapsed by default`、`can't keep clicking every chevron`）。我们已经按需求选择“进行中默认展开”，不应回退。
2. **桌面版精确文案/计数**：闭源、minified、随版本变化；报告中的标签只作为行为参照，不应逐字复制。
3. **终端 TUI 的渲染细节**：ANSI 颜色、`└` 前缀、行宽算法、3 行预览都服务于终端；Web 端应使用自己的折叠/滚动/遮罩。
4. **按工具名硬编码**：桌面版用 renderer 元数据（`standaloneInConversation`、`grouping`）而不是堆名字；我们已有 `isStandaloneTool` 的 kind/name 双通道，建议继续走元数据，新增工具只进集合、不写分支。
5. **Turn 级默认折叠**：`Worked for {time}` 适合“长过程、短结论”的回合；如果我们的用户更常监督执行过程，强制折叠会与“进行中展开”冲突。可作为可选设置，而不是默认。

---

## 7. 复现方式与证据附录

### 7.1 只读读取桌面版 asar

```bash
# 列出匹配的 chunk
python outputs/codex-recon/read_asar_entry.py \
  "C:\Program Files\WindowsApps\OpenAI.Codex_26.1023.6123.0_x64__2p2nqsd0c76g0\app\resources\app.asar" \
  "activity" --list

# 打印单个 chunk（不落盘）
python outputs/codex-recon/read_asar_entry.py "<asar>" "active-tool-activity-label" \
  | frontend/node_modules/.bin/esbuild --loader=js --format=esm --log-level=error
```

说明：`read_asar_entry.py` 只解析 header、按 `8 + headerSize + offset` 读取指定 entry；不整包解压、不写文件。`esbuild` 仅做本地格式化，不安装新依赖。

### 7.2 开源 TUI 稀疏检出

```bash
git clone --depth=1 --filter=blob:none --sparse https://github.com/openai/codex.git outputs/codex-src
cd outputs/codex-src
git sparse-checkout set codex-rs/tui/src codex-rs/protocol/src codex-rs/tools/src codex-rs/app-server-protocol
```

### 7.3 关键证据清单

**开源 TUI**

- `codex-rs/tui/src/exec_cell/model.rs`：ExecCell、`is_exploring_call`、`add_call`、`should_flush`、`complete_call`
- `codex-rs/tui/src/exec_cell/render.rs`：`Exploring/Explored`、`group_len`、Read/List/Search/Run、单命令标题
- `codex-rs/tui/src/exec_cell/compact.rs`：3 行预览、`(no output)`、disclosure 条件
- `codex-rs/tui/src/exec_cell/transcript.rs`：展开态时间顺序
- `codex-rs/tui/src/history_cell/activity_group.rs`：calls + details、prepend
- `codex-rs/tui/src/history_cell/activity_preview.rs`：`DETAIL_PREVIEW_LINES = 3`
- `codex-rs/tui/src/thread_transcript/exploration_groups.rs`：历史分页修复
- `codex-rs/tui/src/thread_transcript/computer_groups.rs`：计算机活动邻接修复
- `codex-rs/tui/src/history_cell/computer_activity.rs`：`Using/Used computer · N actions · M failed`
- `codex-rs/tui/src/thread_transcript/tools.rs`：CommandHistory / McpHistory / fallback
- `codex-rs/tui/src/chatwidget/tests/exec_flow.rs`：聚合行为快照

**桌面版 asar chunk**

> 原始格式化产物在 `outputs/codex-recon/desktop-activity/`（`outputs/**` 已被 gitignore，不入库）；旧版 Memory 逆向快照 `outputs/codex-recon`（26.915）仅用于脚本复用与版本对照，不作为当前实现证据。

- `collapsed-turn-disclosure-eece0cb2b528.js`：`Worked for {time}` / `{count} previous messages` / denied count
- `worked-for-item-content-78646966229e.js`：loading/unknown/paused/working/worked/stopped
- `active-tool-activity-label-682b84df8592.js`：Reading/Searching/Listing/Running/Ran/Stopped
- `split-items-into-render-groups-195e10055074.js`：`toolGroupStartItems` / `grouping === 'groupable'`
- `agent-activity-item-939c4776206c.js`：`groupable` / `standalone` 分类
- `inline-followup-markdown-38a6bf24a857.js`：组构建、探索聚合、summary parts
- `subagent-activity-chip-group-3c945b5e2db4.js`：组渲染、默认收起、`max-h-56`
- `agent-activity-item-row-4e87dc89e455.js` / `activity-row-39cace2a03b5.js`：活动行/通用行
- `activity-state-label-2592167e3f26.js`：Working/Searching/Creating/Thinking/Needs input 等状态词

**公开 UX 证据**

- `https://community.openai.com/t/feature-request-always-expand-codex-activity-tool-logs/1400676`
- `https://community.openai.com/t/ran-command-no-longer-shows-what-it-does/1397706`
- `https://github.com/openai/codex/issues/37213`（检索摘要，未逐字核对）

### 7.4 版本对照

| 项 | 值 |
|---|---|
| 桌面版 | `OpenAI.Codex 26.1023.6123.0` |
| asar 大小/文件数 | 659,553,390 B / 22,333 |
| 桌面 UI | Electron 42 / owl，闭源，无 source map |
| 开源 TUI | `openai/codex` @ `26ad281fd1ca712e4f0c7920a6273cf18c961b8a` |
| 许可 | Apache-2.0（仅开源仓库，不含桌面二进制） |

---

## 8. 一句话总结

Codex 的成熟之处不在于“把工具折起来”，而在于**折叠后那一行仍然能说清楚刚刚发生了什么**：桌面版用语义 summary + 活跃动作标签，TUI 用 `Explored` + Read/List/Search 明细。我们当前的折叠机制已经具备“何时展开/收起”的正确语义，下一步最值得补的是**摘要的语义密度**和**长内容的限高**，而不是继续调整默认展开状态。
