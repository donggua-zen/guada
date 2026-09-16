# 摘要请求与主请求前缀对齐方案（KV 缓存最大化）

> 状态：**已实施完成**（2026-08-30）。tsc 零错误；test/chat + test/agent-engine + test/llm-core **16 套件 136 用例全绿**。
> 实施：检查点消息 `role: 'event' → 'user'`（=system/user/assistant）；删除 cleanRegion 过滤（遮蔽区原样 → 前缀逐字节一致 → KV 缓存命中）；extractPreviousSummary 改按 source.plugin='compact' 识别；serializeMessages 不再跳过检查点（旧摘要进序列化文本）。wire 层零变化（四 adapter 对 event/user 本映射为同一 role）。
> **前端零影响**前端（frontend/src/services/modules/streamProjector.ts）是独立事件流折叠体系——从 `compaction/summary` 事件自己投影（移除遮蔽消息 + 自生成 `role:'event'` 占位块，`:355-368`），replay 页与 live 共用同一折叠器（`:705`）；本次只改后端折叠产物，落库事件未动。
> **第七章完善已实施**LLMSummaryProvider 新增 buildParams 选项（compaction.service 注入 buildSessionLlmParams）→ 摘要请求 thinkingEffort/temperature/modelCapabilities 与主请求同源（思考模式一致，前缀缓存不失效）；COMPACTION_INSTRUCTION 改英文（DSH 结构）+ `<system_reminder>` 标签包裹 + "Do NOT call any tool" 规则；新增 buildParams 复用测试（参数同源 + system/tools/maxTokens override 断言）。

## 一、现状缺陷（已确认）

`llm-summary.provider.ts:171`：

```ts
const cleanRegion = shadowed.filter((m) => m.role !== 'event'); // ← 过滤 event 消息
```

**问题**二次压缩场景下，旧摘要（`role='event'` 的 compaction 摘要消息，fold 时置消息头）落在遮蔽区（头部连续前缀）内。摘要请求把 event 消息过滤掉后：

```
主请求 wire: [system, tools, u1, a1, <event 摘要→user>, u2, a2, ...]
摘要请求 wire: [system, tools, u1, a1, , u2, a2(部分), instruction]
                              └────── 前缀错位 → KV 缓存 miss ──────┘
```

前缀一旦错位，provider 缓存全部失效——与"最大化缓存利用"的目标背道而驰。

## 二、目标形态

DSH（`deepseek-harness/packages/compaction/compaction-basic/src/summarizer.ts`）：

```ts
export interface SummarizationInput {
  readonly system?: string // 与主请求一致的 system（KV 前缀对齐）
  readonly tools?: readonly ToolSchema[] // 与主请求一致的 tools
  readonly messages: readonly Message[] // shadowed region（含检查点消息，无 event 过滤）
}
```

GuaDa 对应目标：

```
摘要请求 = {
  system: 会话 systemText（与主请求逐字节一致，同源 getSystemText）
  tools: 会话 tools（与主请求逐字节一致，同源 getTools）
  messages: [
    ...遮蔽区原样（含 event 摘要消息，不再过滤）, // = 主请求真前缀
    instruction user 消息 // 唯一 novel 后缀
  ]
}
```

**为什么 event 消息必须保留**1. 主请求 view 含 event 摘要消息（`replayer.ts:426` 构造，wire 层被 openai adapter 映射为 `role:'user'`，`:275`），是主请求前缀的一部分。
2. 摘要请求若过滤 → 前缀与主请求不一致 → 缓存 miss（现状缺陷）。
3. 保留 → 前缀逐字节一致 → 命中；且 event 消息文本（旧摘要）经 wire 转换后模型**直接看到旧检查点**增量合并（DSH 检查点式），`extractPreviousSummary` 退化为双保险。

**为什么保留区（不被遮蔽的消息）不参与**（用户强调点）：
- 保留区在主请求中位于遮蔽区**之后**（遮蔽 = 头部连续前缀，保留 = 尾部）。
- 摘要请求前缀只延伸到遮蔽区边界——**缓存命中要求前缀一致，不要求后缀一致**；保留区既不在前缀内（放进去不提升命中），也不是后缀（instruction 才是），放进摘要请求只会浪费 token。
- 与 DSH 一致：`SummarizationInput.messages` = shadowed region only。

## 三、与记忆同步影子轮次的对照

| | 影子轮次（memory-sync） | 摘要请求（本方案） |
|---|---|---|
| 数据源 | `getHistory` 完整 surface | 遮蔽区（`getHistory` 的头部前缀） |
| 前缀 | system + tools + 完整 surface = 主请求**完整前缀** | system + tools + 遮蔽区 = 主请求**真前缀** |
| 后缀 | memory 指令（user） | 摘要指令（user） |
| 前缀取多长的依据 | memory 同步需要全量上下文 | 总结对象仅遮蔽区，取到遮蔽区边界即止 |

**共同原理**请求 = 主请求前缀（逐字节一致）+ 唯一 novel 后缀 → 命中 provider warm prefix cache。
差异只在"前缀取多长"——由任务需要决定（记忆要全量、摘要只要遮蔽区）。

## 四、改动清单

1. **`llm-summary.provider.ts:171`**去掉 event 过滤：

```ts
// 遮蔽区原样（含 event 摘要消息）——与主请求前缀逐字节一致，KV 缓存命中
const region = shadowed;
return {
  system: this.options.prefix.system,
  messages: [
    ...(region.length > 0 ? region : [this.placeholderMessage(EMPTY_REGION_PLACEHOLDER)]),
    this.instructionMessage(instruction),
  ],
  tools: this.options.prefix.tools,
};
```

2. **`extractPreviousSummary`**保留（指令 checkpointBlock + 消息流 event→user 双保险）。后续若前端展示/模型兼容验证通过，可删指令冗余。

3. **确认 wire 一致性**（已验证）：
   - event 摘要消息 wire 映射为 `role:'user'`（openai `:275` 三元映射）——主请求与摘要请求中同一对象，形态一致；
   - system/tools 同源（会话 `getSystemText` / `getTools`）；
   - 遮蔽区 = `getHistory` 前缀（fold 语义保证头部连续）。

4. **摘要请求 token**遮蔽区含 event → 略增（正确：旧检查点本应被模型看到，非浪费）。

5. **测试**二次压缩场景——摘要请求遮蔽区含 event 摘要消息，且 wire 前缀与主请求前缀逐字节一致（断言 `call.messages` 前缀 = view 头部同序消息）。

## 五、DSH 对照结论

DSH 的 `SummarizationInput` 天然无 event 过滤（其检查点是**可见 plugin 消息**`source.plugin='compact'`，在 region 内）。GuaDa 的检查点是 `role='event'` 事件消息（fold 可见但 wire 前被误过滤）——**去掉过滤后，GuaDa 摘要请求的 wire 形态与 DSH 完全一致**`{ system, tools, [region..., instruction] }`。这是向 DSH 形态收敛的一步，无需改动检查点表示。

## 七、完善：摘要请求对齐主请求（复用 builder + 思考一致 + 工具限制 + 英文指令）

> 状态：方案（2026-08-30 晚）。三处查漏补缺。

### 7.1 复用请求构建器（`session-llm-request.builder`）

**现状缺陷**`session-llm-request.builder.ts` 文件头注释明写"收敛**主循环 / 影子轮次 / 摘要**的 LLM 参数组装（modelConfig/tools/thinkingEffort 一次提取）"——设计意图即含摘要；但 `LLMSummaryProvider.generate` 手工组装 `completions` 参数，与 builder 完全脱节。

**修正**`LLMSummaryProvider` 增加 `buildParams` 选项（compaction.service 构造时注入，内部 = `buildSessionLlmParams(ds, opts)`）：

```ts
// compaction.service.ts buildSummaryProvider
new LLMSummaryProvider(llmService, model, {
  maxSummaryTokens: 2000,
  abortSignal,
  prefix: { system, tools },
  buildParams: (messages: Message[]) =>
    buildSessionLlmParams(ds, {
      messages,
      purpose: 'compaction',
      stream: true,
      maxTokens: 2000,
    }),
})
```

```ts
// llm-summary.provider.ts generate —— 复用 builder 组装
const params = this.options.buildParams(requestMessages.messages);
params.system = requestMessages.system; // 前缀一致（override）
params.tools = requestMessages.tools; // 前缀一致（override）
const stream = await this.llmService.completions(params);
```

效果：**thinkingEffort（ctx.getThinkingEffort）／temperature／modelCapabilities／providerConfig 全部与主请求同源**参数零漂移。

### 7.2 思考模式必须与主对话一致（前缀失效点）

**现状缺陷**`llm-summary.provider.ts` 硬编码 `thinkingEffort: resolveThinkingEffort(this.model, 'none')`——主对话思考模式下（如 DeepSeek reasoning 回传），摘要请求 `none` 导致请求组装（thinking 配置 / reasoning_content 回传）与主请求不一致 → **前缀缓存失效**。

**修正**7.1 复用 builder 后自动一致（builder 取 `ctx.getThinkingEffort`）。删除硬编码。

**副作用说明**摘要请求带 thinking → 摘要模型可能输出 reasoning 块；`BlockAssembler` 已 filter text 块（只取 text），摘要纯文本不受影响。若压缩模型（SK_MOD_COMPRESS_MODEL）与主对话模型不同且不支持该 effort，由 provider 层容错（复用 builder 的 modelCapabilities/thinkingEffort 透传，adapter 按模型处理）。

### 7.3 限制工具调用

**现状**摘要请求传 tools（前缀一致必需），但中文指令无明确禁止工具。

**修正**指令加 DSH 原文规则——**"Do NOT call any tool or take any other action."**；摘要调用是单次 stream（无工具执行循环），tools 照传只为前缀一致，模型不会真正执行（DSH 同款：不设 tool_choice，指令禁止）。

### 7.4 英文指令 + `<system_reminder>` 标签

**现状**`COMPACTION_INSTRUCTION` 是中文、无标签包裹。

**修正**（参考 DSH 结构 + GuaDa `<system_reminder>` 惯例）：

```ts
const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  '## Key Technical Concepts',
  '## Files and Code',
  '## Errors and Fixes',
  '## Pending Jobs',
  '## Current Work',
  '## Next Step',
  '## Critical Context',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Do NOT call any tool or take any other action.',
  '- If the conversation already contains a <compacted-summary> block, it is a PRIOR checkpoint. Merge newer information into a single consolidated summary under the same structure.',
].join('\n')

// instruction 消息文本：<system_reminder> 标签包裹（GuaDa 惯例，同 agent-engine:615 / process-manager:167）
const instructionText =
  `<system_reminder>\n${COMPACTION_INSTRUCTION}\n\n${checkpointBlock}压缩检查点：\n</system_reminder>`
```

标签约定：
- **`<system_reminder>`**包裹摘要指令（GuaDa 既有惯例，系统级注入提示）
- **`<compacted-summary>`**旧检查点/输出包裹（DSH 式，保留现状）

### 7.5 改动清单

1. `llm-summary.provider.ts`：`LLMSummaryProviderOptions` 加 `buildParams`；`generate` 改用 builder 组装（删硬编码 thinkingEffort/temperature）；`COMPACTION_INSTRUCTION` 改英文 + `<system_reminder>` 包裹。
2. `compaction.service.ts`：`buildSummaryProvider` 注入 `buildParams`（复用 `buildSessionLlmParams(ds, ...)`）。
3. 测试：摘要请求参数与主请求一致性断言（thinkingEffort 同源 / system/tools override 生效 / 无工具调用规则在指令文本中）。
