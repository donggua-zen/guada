# 请求信封与对话历史分离方案（DSH 式 envelope/surface）

> 状态：**已实施完成**（2026-08-30）。tsc 零错误；test/chat + test/agent-engine 15 套件 132 用例全绿；plugins 146 用例过（browser.plugin 为既有失败）。
> 实施内容：LLMCompletionParams.system + 4 adapter system 映射（新增 openai-system.spec.ts）；会话层 buildSystemText + getSystemText + getMessages 删除；builder 零拼接；调用方迁移（agent-engine/memory-sync/session.service/compaction）；压缩 KV 前缀改 {system, tools} + SummaryInput 删 shadowedMessageIds；**todo 压缩后落库注入**（MEMORY_COMPACTED + injectUserPrompt，废弃 collectUserPrompts）。

## 一、根因：一个数组装了两类数据

现状 `LLMCompletionParams.messages`（`Message[]`）里同时装了：

| 数据 | 性质 | 例子 |
|---|---|---|
| **envelope**（可变配置） | 每次请求由配置决议，可变 | system 提示词、插件 user 提示、工具定义 |
| **surface**（不可变事实） | 事件溯源落库，不可变 | 用户消息、助手消息、工具结果 |

两个性质不同的东西共用 `Message[]` 表达，产生四个症状：

1. **接口成对**`ISessionContext` 要有 `getMessages`（含 envelope 的完整请求）+ `getHistory`（纯 surface），且要求两者"逐字节一致"，成对维护。
2. **语义撒谎**prelude 的 system 消息 `source: { kind: 'user' }`（`jsonl-session-context.ts:914`）；且 `openai.adapter.ts` 的 `formatMessages` 不识别 system 消息（role 三元映射 `assistant ? assistant : user`），**system 提示词以 user 角色发出**。
3. **压缩补差**压缩引擎只收 surface（`getHistory`），但预算要全量口径 → `requestTokens` 与 history 的差值（envelopeDelta）由调用方反复折算。
4. **摘要旁路**检查点用不可见事件消息承载（`role='event'`），KV 组装时被过滤 → 需要 `extractPreviousSummary(allMessages)` 旁路 + `SummaryInput` 双数组。

## 二、目标形态

DSH 的 `LlmCallConfig`（`deepseek-harness/packages/llm/llm/src/types.ts`）：

```ts
messages: Message[]; // 对话历史，providers 看到的样子（system 槽之后）
system?: string; // 独立字段，adapters 映射到 provider 的 system 槽
tools?: ToolSchema[]; // 独立字段
```

GuaDa 对应改造：

```ts
export interface LLMCompletionParams {
  model: string;
  system?: string; // 新增：系统提示词文本
  messages: Message[]; // 语义变化：纯对话历史（surface），不再含 system
  tools?: ToolDefinition[]; // 已有
  // 其余字段不变
}
```

**分层职责（谁做什么）**| 层 | 职责 | 输入/产出 |
|---|---|---|
| 会话层 | surface（`getHistory`）+ envelope 源（`getSystemText` / `getTools`） | 单一数据源，`getMessages` 消失 |
| 组装层 builder | 从 ctx 读 surface + envelope，产出 `{system, tools, messages}` | 无状态纯组装 |
| 协议层 adapter | 把 `system` 映射到各协议槽位 | **唯一知道 system 该放哪的层** |
| 压缩层 | 消费 surface + envelope 信息 | 主请求 = system + surface 天然一致 |

## 三、阶段 1 改动清单（本次交付）

### 3.1 `LLMCompletionParams`（llm-core/types/llm.types.ts）

加字段 + 更新注释：

```ts
/** 系统提示词文本（协议槽位由 adapter 映射：OpenAI 数组首条 / Anthropic 独立字段 / Gemini systemInstruction） */
system?: string;
/** 纯对话历史（surface），不含 system —— 组装见 session-llm-request.builder */
messages: Message[];
```

### 3.2 会话层（jsonl-session-context.ts + session-context.ts）

- `buildPreludeMessages` 重构：
  - `system` 部分（systemPrompt + 插件 eager 提示）→ 拼成 `systemText` 字符串；
  - `user_prompt`（插件 user 型提示）→ **保留为前导 user 消息数组** `leadingUserParts`（不入 system，见决策点）。
- 新增 `getSystemText: string` 与 `getLeadingUserMessages: Message[]`（builder 消费）。
- `getMessages` **删除**；调用方全部改 `getHistory`（surface）。
- `getPrelude` 保留给压缩 KV 前缀（见 3.5）。
- 快照层不动：`view` 即 surface，`getHistory` 直接返回快照 view（O(1)）。

**决策点（user_prompt 去向）——修订 2（2026-08-30）：废弃固定前导注入，改为"压缩后落库注入"（todo 遗忘防护）。**

- **不并入 system**user_prompt 是"内容/上下文"而非"指令"，进 system 槽语义错位。
- **不保留为前导 user 消息**（曾定案）：前导注入每次请求都进请求顶部，注意力被 system 稀释；且 todo 状态是易变会话状态，不该进请求 envelope。
- **采用：废弃 collectUserPrompts 机制；todo 状态改为压缩后以隐藏消息落库注入**- 触发：`HOOKS.MEMORY_COMPACTED`（压缩完成事件，`todo.plugin` 已在监听；发射时机在 `refreshAfterCompaction` 之后，handler 读到压缩后视图 ✓）
  - 注入条件（继承现状守卫，`hasTodoCall` 反用）：store 有待办 && **历史无 todo 工具调用** → 注入提醒；有调用 → 不注入
  - 语义：**压缩后遗忘防护**——压缩遮蔽早期 todo 调用 → AI 可能遗忘待办 → 提醒；AI 更新后条件不成立自动停；AI 未更新则再次压缩再次提醒（条件驱动，天然幂等，无需去重）
  - 消息形态（基础设施已存在）：`role='user'` + `kind='model'` + `source={kind:'plugin', plugin:'todo'}` + `metadata.hidden=true`，写 `user/message` 事件落库 → fold 进 view → 走快照增量（版本号契约已就绪）
  - 连带删除：`prompt-collector.collectUserPrompts` 与 `type:"user"` 分支（全仓唯一使用者是 todo）、prelude 的 user_prompt 拼接分支 → prelude 只剩纯 system 文本，envelope/surface 分离中"前导拼接"概念消失

### 3.3 组装层 builder（session-llm-request.builder.ts）

```ts
export function buildSessionLlmParams(
  ctx: ISessionContext,
  opts: { messages: Message[]; /* 其余不变 */ },
): LLMCompletionParams {
  const modelConfig = ctx.getModelConfig;
  return {
    model: modelConfig.modelName,
    system: ctx.getSystemText, // envelope：system 文本（纯文本，无消息前导）
    messages: opts.messages, // surface：调用方传 getHistory（零拼接）
    tools: ToolOrchestrator.toFlatToolDefs(ctx.getResolvedPlugins),
    temperature: modelConfig.config.temperature,
    // ...其余照旧
  };
}
```

> 注：`user_prompt` 前导已废弃（见 3.2 决策点修订 2——todo 状态改压缩后落库注入），builder 无需拼接任何前导消息，`messages` 即纯 surface。

### 3.4 协议层 adapter ×4（system 协议映射，纯增量）

| adapter | 映射 |
|---|---|
| `openai.adapter.ts` | `messages` 数组头部插 `{role:'system', content}`（有 system 时） |
| `openai-response.adapter.ts` | 同 openai |
| `anthropic.adapter.ts` | `system` 独立字段直接透传 |
| `gemini.adapter.ts` | `systemInstruction` |

`formatMessages` 不再需要识别 system 消息（surface 里本来就没有）；现有"system 消息被当 user 发"的隐性行为随之修正为正确的 system 角色。

### 3.5 压缩层

- **摘要 KV 前缀**（`compaction.service.ts buildSummaryProvider`）：`prefix` 从 `{ prelude: Message[] }` 改为 `{ system: string; tools }`（ `SummarizationInput`）；`llm-summary.provider.ts` 的 `buildRequestMessages` 相应组装 `system + cleanRegion + instruction`。
- **预算**`requestTokens` 传入逻辑保留（`getTokenCount` 已走快照前缀和 O(1)），无需改动。
- **`SummaryInput` 收敛**（顺带）：`shadowedMessageIds` 删除（零消费）；`allMessages` 保留到阶段 2 检查点改造（见四）。

### 3.6 调用方迁移

| 文件 | 改动 |
|---|---|
| `agent-engine.service.ts:457` | `getMessages` → `getHistory`（其余不变，builder 已拼 envelope） |
| `memory-sync.service.ts:69` | 同上（影子轮次走 builder 组装） |
| `session.service.ts:762/805/816` | `getMessages` → `getHistory`（只读数量/统计） |
| `compaction/types.ts` + `compaction.service.ts` | `CompactionDataSource.getMessages` → `getHistory`（压缩返回 surface） |
| `ISessionContext`（session-context.ts） | 移除 `getMessages`，新增 `getSystemText` |

### 3.7 测试

- adapter ×4：`system` 映射单测（OpenAI 数组首条 / Anthropic 独立字段 / Gemini systemInstruction / 无 system 时不插）。
- builder：产出断言（`system` = getSystemText，`messages` = 传入 surface）。
- engine 集成：getHistory + builder 组装后请求结构正确。
- 回归：`test/chat` + `test/agent-engine` 全绿。

## 四、独立子方案：todo 压缩后落库注入（已评估，推荐实施）

**背景**`user_prompt`（前导注入）全仓唯一使用者是 todo 插件（`todo.plugin.ts:138`，`type:"user"`，注入当前待办状态）。现废弃前导机制，改为压缩后落库注入——见 3.2 决策点修订 2。完整设计：

| 项 | 设计 |
|---|---|
| 触发 | `HOOKS.MEMORY_COMPACTED`（todo.plugin 已在监听；发射在 `refreshAfterCompaction` 之后，handler 读到压缩后视图） |
| 注入条件 | store 有待办 && 历史（压缩后 view）无 todo 工具调用 → 注入；有调用 → 不注入 |
| 语义 | **压缩后遗忘防护**压缩遮蔽早期 todo 调用 → AI 可能遗忘待办 → 提醒；AI 更新后自动停；未更新则下次压缩再提醒（条件驱动幂等，无需去重） |
| 消息形态 | `role='user'` + `kind='model'` + `source={kind:'plugin', plugin:'todo'}` + `metadata.hidden=true`，`user/message` 事件落库 → fold 进 view → 快照增量（版本号契约已就绪） |
| 依赖的现状 | `appendMessages` 的 kind=model 注入分支（`metadata.hidden`）已存在；`replayer` 已支持折叠；`estimatePerMessage` 对 hidden 消息照常计 token（占上下文，正确） |
| 删除 | `prompt-collector.collectUserPrompts` + `type:"user"` 分支；prelude 的 user_prompt 拼接分支 |

**改动清单**1. `todo.plugin.ts`：`handleCompacted` 从"清缓存"改为"清缓存 + 注入检查"（需 async 处理，EventBus emit 是同步 fire-and-forget，handler 自行管理异步）
2. `jsonl-session-context.ts`：新增 `injectTodoSnapshot(content)`（或通用 `injectUserPrompt`），走 `appendMessages` kind=model 分支 + 快照增量
3. 删除 `collectUserPrompts` 及 prelude user_prompt 分支
4. 前端：hidden 消息显示策略（可选，先不显示）

**不做的部分（仍否决）****检查点改可见 plugin 消息**（`plugin:'compact'`）：独立主题；当前 `extractPreviousSummary` 旁路可正常运转，`SummaryInput.allMessages` 的冗余仅造成轻微接口噪音，非正确性问题。如未来做，收益是消除旁路、接口收敛到 DSH 形状，需评估前端对 event 消息展示的影响。

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| system 角色变化（OpenAI 之前以 user 发，改造后以 system 发）改变模型行为 | 标注为**有意的行为修正**；回归测试确认对话/工具调用正常；可灰度观察 |
| `user_prompt` 并入 system 后插件提示上下文位置变化 | 语义等价（同为请求前缀指令）；A/B 验证记忆类插件 |
| `getMessages` 删除的调用方遗漏 | tsc 编译期兜底（接口签名变化必报错）；全仓 grep 调用点核对 |
| 影子轮次（memory-sync）组装路径回归 | 单测覆盖：影子轮次请求 = builder(surface) 与原 getMessages 结构一致（system 位置除外） |

## 六、实施顺序

1. **3.1 + 3.4**（LLMCompletionParams + adapter）：纯增量，无破坏，先行。
2. **3.2 + 3.3**（会话层 systemText + builder）：核心。
3. **3.6**（调用方迁移）：tsc 驱动逐个清。
4. **3.5**（压缩 KV 前缀 + SummaryInput 清理）：收尾。
5. **3.7**（测试）+ 回归。
