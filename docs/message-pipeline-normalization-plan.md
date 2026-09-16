# 消息管线规范化方案：图片转换归位 + getMessages 后处理重构

> 状态：方案评审稿 v1（2026-08-30）
> 范围：backend-ts 消息流转链路（上下文组装 → 序列化 → adapter）
> 参照：deepseek-harness（下称 DSH）核心/适配器分层 + 旧版 master（数据库版本）统一转换逻辑
>
> **后续变更（2026-09）**：附件引用形态与落点已统一（新增 `FileRef.refType`：
> store / workspace / local，普通文件落会话工作目录、不再预解析内容），
> L1 管线新增 `file-path-bridge` 步骤，`fileBlockToText` 的签名与输出文案也已改变。
> 本文件保留为当时的分层决策记录，**实现现状请以
> [chat-attachment-ref-design.md](./chat-attachment-ref-design.md) 为准**。

---

## 1. 问题定义

三个相互纠缠的问题：

1. **base64 转换散落在各 adapter**openai / anthropic / gemini / openai-response 四个 adapter 各自实现「附件引用 → 协议图片格式」，其中「file 块 → `[文件: name (url)]` 文本」逐字重复四处，「dataUrl 正则拆 mime/base64」重复两处。`base.adapter.ts` 只有接口定义，零共享实现。
2. **能力降级链路断裂**`jsonl-session-context.ts:181` 把 `supportsImageInput` 传入 `loadContext`，但存储层完全未消费（死参数）。旧版 `transformImageFile(file, supportsImageInput)` 的「支持 → base64 / 不支持 → `[图片ID：x]` + 工具调用」逻辑在重构后丢失。当前 image 块无条件发往 API，纯文本模型直接报错或被静默忽略。
3. **后处理无结构**`loadVisibleMessages` 里 reasoning 填充/剥离、KIMI 空 content 兼容以散落的 if/map 内联在方法体中，无命名、无顺序契约、无单测锚点；provider 兼容细节（DeepSeek reasoning_content 回传、cache_hit_tokens 等）散在多个 adapter 中，新增 provider 时无处安放。

## 2. 现状事实清单（已逐文件核实）

| 位置 | 现状 |
|---|---|
| `llm-core/adapters/openai.adapter.ts` L218-310 | `formatMessages`（reasoning_content 回传 L253-258）+ `resolveLocalImageParts`（attachmentToDataUrl → image_url） |
| `llm-core/adapters/anthropic.adapter.ts` L453-587 | tool_result 合并、thinking+signature 回传、image→source（正则拆 dataUrl）、file→文本、patchMissingToolResults |
| `llm-core/adapters/gemini.adapter.ts` L214-279 | image→inlineData（再次正则拆 dataUrl）、file→文本、functionCall/Response |
| `llm-core/adapters/openai-response.adapter.ts` L143-220 | image→input_image **只透传 url 未转 base64**（与其他 adapter 行为不一致） |
| `llm-core/adapters/base.adapter.ts` | 仅 `IProtocolAdapter` 接口，无共享逻辑 |
| `llm-core/utils/attachment.util.ts` | 已有 `resolvePhysicalPath` / `attachmentToDataUrl` / `guessMediaType` 公共助手 + 磁盘缓存 TODO |
| `chat/jsonl-session-context.ts` L173-228 | `loadVisibleMessages`：reasoning 填充/剥离（L190-212）+ KIMI 空 content 兼容（L215-220），内联无结构 |
| `common/persistence/jsonl-message.service.ts` L341-355 | `loadContext` 忽略 `supportsImageInput`（死参数）；`replayer.ts deriveMessages` 纯投影 |
| 旧版 `master:.../chat/message.service.ts` | `loadMessages(L516)` → `transformContentStructure(L703)` → `transformImageFile(L868-930)`：支持→base64 data URI；不支持→`[图片ID：x]` 文本 |
| 旧版 `master:.../chat/persistent-session-context.ts` L220 | `supportsImageInput: inputCapabilities?.includes("image")`（现行同款判断仍在 L181，只是断了下游） |
| DSH `packages/llm/llm/src/index.ts` L930-936 | `adapterStream`：按 `inputModalities` 在 **dispatch 前**统一调 `projectImagesForTextModel` 投影，所有 provider 共享单条管线 |
| DSH `packages/llm/llm/src/content.ts` | 唯一共享转换层：`contentHasImage` / `projectImagesForTextModel` / `textOnlyImageText` / offload 预算算法 |
| DSH 各 adapter | 只做 wire 格式映射 + fail-loud 二次校验；provider 特有细节（reasoning_content、空 content）全部 adapter 私有，核心包零 provider 分支 |

## 3. 设计决策：base64 转换应该放在哪

### 3.1 结论

**能力判断与「图片去留」放上下文管线（一次性、provider 无关）；字节解析下沉为共享助手；wire 格式映射留在 adapter（天然协议私有）；adapter 保留 fail-loud 最终断言。**

即四层职责：

```
L0 存储层（jsonl-message.service / replayer）
   只存 FileRef 引用，纯事件投影。不认识"模型能力"，保持死参数移除后的干净接口。

L1 上下文管线（新增 message-transform.pipeline.ts，挂在 loadVisibleMessages）
   按【模型能力】参数化的 provider 无关变换，单一有序管线：
   ① imageProjection —— supportsImageInput=true：保留 image 块（不动字节）
                        false：替换为占位文本（含 attachmentId，引导模型调 image_recognize）
   ② reasoningPolicy —— 思考模式：仅最后一轮（turnId === ctx.currentTurnId，beginTurn 记录）
                        完整携带/填充思考，历史轮次剥离；fullReasoningRelay（deepseek-v4 系，
                        /deepseek.*v4/i 命中）例外全量携带；非思考模式剥离（见 §4.4）
   ③ providerCompat —— KIMI 空 content 兼容等，注册为命名步骤，不再内联 if
   输出：归一化的 ContentBlock 消息数组（此时图片仍是引用或占位文本，无 base64）

L2 共享序列化助手（attachment.util.ts 扩展）
   attachmentToPart: FileRef → { mimeType, base64 }（中性形态，含磁盘缓存）
   fileBlockToText: 统一 `[文件: name (url)]` 投影（消灭四处逐字重复）
   只写一次，被所有 adapter 调用。

L3 adapter（薄）
   只做协议映射，每个 adapter 剩 3-5 行：
   openai: {type:"image_url", image_url:{url:`data:${mime};base64,${b64}`}}
   anthropic: {type:"image", source:{type:"base64", media_type, data}}
   gemini: {inlineData:{mimeType, data}}
   最后保留 fail-loud 断言：历史仍含 image 且模型无 image 能力 → 抛 UNSUPPORTED_CONTENT。
```

### 3.2 为什么不放上下文层直接转 base64（旧版做法）

旧版在 `transformImageFile` 里直接读盘转 base64 放进上下文。这有两个问题：

1. **层次混淆**base64 是传输形态而非语义形态。Anthropic/Gemini 需要拆开 mime 和 raw base64，OpenAI 需要 data URL——在 L1 产出任何一种"半成品"都会让另一侧 adapter 再拆一遍（现状 anthropic/gemini 里重复的正则拆分就是这么来的）。
2. **损失可缓存性**L1 的管线结果（含 reasoning 策略、图片投影）可以做会话级缓存；一旦混入大体积 base64 就不可缓存。字节解析留在 L2/L3 边界，配合 `attachmentToPart` 的磁盘缓存（attachment.util.ts 已有 TODO），每个附件每次进程生命周期只读一次盘。

DSH 也是同样的分界：核心管线只做「去留投影」，字节解析（Files API vs base64）留在靠近 adapter 复用核心算法。我们比 DSH 更进一步：把字节解析收敛为**一个**中性助手（因为 GuaDa 五个 adapter 全走 base64，不存在 Files API 分叉），adapter 侧连「读文件」都不再做。

### 3.3 为什么 fail-loud 断言留在 adapter

L1 管线依赖 `modelConfig`，但 adapter 是最终出口，可能被 LLMService 的其他调用方（插件、子代理、bot-gateway 直调）绕过 L1 管线使用。DSH 的做法（`llm-deepseek/adapter.ts:442` 抛 `UNSUPPORTED_CONTENT`）证明：**投影是优化，断言是正确性**。断言放 adapter 保证不变量在任何入口下都成立。

## 4. getMessages 后处理规范化

### 4.1 管线化

把 `loadVisibleMessages` 重建为显式管线：

```typescript
// chat/message-transform.pipeline.ts（新增）
export interface TransformStep {
  name: string; // 'image-projection' | 'reasoning-policy' | ...
  enabled(ctx: TransformContext): boolean;
  apply(messages: Message[], ctx: TransformContext): Message[];
}

export class MessageTransformPipeline {
  register(step: TransformStep): void; // 按注册顺序执行，全部纯函数（Message[] → Message[]，副本变换）
  run(messages: Message[], ctx: TransformContext): Message[];
}

// TransformContext: { supportsImageInput, thinkingEffort, providerProtocol, modelName }
```

现有三段内联逻辑各归各位：

- `image-projection`：新增（见 §3），**消费目前死掉的 supportsImageInput**
- `reasoning-policy`：L190-212 原样迁入
- `kimi-empty-content`：L215-220 迁入，按 provider/model 触发

### 4.2 provider 兼容的归属规则

 原则「核心零 provider 分支」：

- **语义级、跨协议共享**的兼容 → L1 管线的命名步骤（按 modelName/protocol 触发），如 KIMI 空 content。
- **wire 级、协议私有**的兼容 → 留在该 adapter 内部（如 DeepSeek `reasoning_content` 回传、`cache_hit_tokens` usage 兼容），但**必须**在 adapter 文件头用注释块登记（`// Provider quirks: 1) reasoning_content 须持续回传 …`），形成每个 adapter 的「怪癖清单」，新增 provider 时对照。
- 迁移期间对 master 分支旧代码（`persistent-session-context.ts` 的 DeepSeek 策略注释）做一次逐条审计，确认无遗漏后归档。

### 4.3 移除死参数

`ContextLoadParams.supportsImageInput` 从存储层接口删除（L1 管线已消费），存储层回归纯投影。`anchorTurnId` / `maxMessages` 截断保留。

### 4.4 reasoning 策略：最后一轮判定与 deepseek-v4 全量回传例外

存储侧始终原样保存 reasoning（写侧过滤会永久丢失真实思考），策略全部在读取侧管线执行：

| 场景 | 最后一轮 assistant | 历史轮次 assistant |
| --- | --- | --- |
| 非思考模式 | 剥离 reasoning 块 | 剥离 |
| 思考模式（默认） | 保留完整思考；无块补 `{summary:' '}`、空 summary 填 `' '` | 剥离 |
| 思考模式 + fullReasoningRelay | 保留 + 填充 | 保留 + 填充 |

- **最后一轮以 `currentTurnId` 显式判定**（`JsonlSessionContext.beginTurn` 记录，经 `TransformContext.currentTurnId` 传入）：消息 `turnId === currentTurnId` 即最后一轮。按回合而非按「最后一条 assistant」界定，保证 agent 工具调用循环中同回合多条 assistant 均完整携带（Anthropic 签名回传依赖）。变换与视图位置/时序无关，O(Δ) 增量拼接永远正确。`currentTurnId` 缺省时全部视为最后一轮（保守回退 = 历史全量携带）。
- **`fullReasoningRelay`** 由会话层依据 `isFullReasoningRelayModel(modelName)`（`/deepseek.*v4/i`，与 model-preset-library deepseek-v4 预设 pattern 一致）派生：该族端点要求 reasoning 跨轮持续回传。仅在思考模式生效，非思考模式一律剥离。
- **快照联动**`currentTurnId` 计入 `transformKey`（回合变化即全量重建）；`appendToSnapshot` 增量拼接前校验指纹，不一致即作废快照防御（正常生命周期内 context 限单回合，此分支不触发）。

## 5. 实施计划（三阶段，零 DB 迁移）

### 阶段一：共享助手下沉（纯重构，行为不变，~0.5 天）

1. `attachment.util.ts` 新增 `attachmentToPart: Promise<{mimeType, base64} | null>`（内部复用 `resolvePhysicalPath`，实现磁盘缓存 TODO：`<attachmentId> → {mime, b64}` 内存 LRU + 可选磁盘落盘）。
2. 新增 `fileBlockToText`，替换 openai/anthropic/gemini/openai-response 四处逐字重复。
3. 各 adapter 的图片分支改为调 `attachmentToPart` + 各自 3-5 行 wire 映射；删除 anthropic/gemini 的 dataUrl 正则拆分。
4. **顺带修复**openai-response.adapter 的 image 分支从「只透传 url」改为与其他协议一致的 base64（或显式记录为该协议的有意行为）。
5. 验收：现有测试全绿；新增 `attachment.util.spec.ts` 覆盖缓存命中/失效。

### 阶段二：L1 管线 + 图片降级闭环（核心功能，~1 天）

1. 新建 `chat/message-transform.pipeline.ts`（管线骨架 + TransformContext）。
2. 迁移 reasoning-policy、kimi 兼容两个步骤；`loadVisibleMessages` 改为组装管线调用（行为等价）。
3. 实现 `image-projection` 步骤：不支持图像时 image 块 → `[图片已省略：当前模型仅支持文本。可用 image_recognize 工具识别，image_id: ${attachmentId}]`（占位文案引导模型主动调工具，衔接已有 image-recognition 插件；比 DSH 的纯占位更进一步）。
4. 每步一个 `spec.ts` 纯函数测试（无需启动 Nest）。
5. 验收：DeepSeek 纯文本会话带图发消息 → 模型收到占位文本，可调 image_recognize；多模态模型行为不变。

### 阶段三：adapter 断言 + 怪癖登记（防御收尾，~0.5 天）

1. 各 adapter 序列化入口加 fail-loud 断言（历史含 image 且模型无 image 能力 → `UNSUPPORTED_CONTENT`）。
2. 各 adapter 文件头登记 Provider quirks 注释块；对照 master 旧代码做 DeepSeek/KIMI 细节审计清单，逐条勾对。
3. 删除 `ContextLoadParams.supportsImageInput` 死参数。

**总工作量约 2 天，改动集中：新增 2 文件、修改 ~8 文件、零 DB 迁移、bot-gateway 与前端零感知。**

## 6. 改造前后对照

| 关注点 | 现状 | 改造后 |
|---|---|---|
| 图片 → base64 | 4 个 adapter 各写一遍，行为还不一致 | `attachmentToPart` 一处 + 各 adapter 3-5 行映射 |
| 模型不支持图片 | 无保护，API 报错/静默忽略 | L1 投影为带 image_id 的占位文本 + adapter fail-loud |
| reasoning 处理 | loadVisibleMessages 内联 if/map | 命名管线步骤 + 单测锚点 |
| provider 兼容 | 散落各处 | 语义级进管线，wire 级 adapter 怪癖清单登记 |
| supportsImageInput | 死参数 | 存储层删除；管线消费 |
| 磁盘缓存 | TODO | attachmentToPart 内实现 |

## 7. 风险与对策

- **管线顺序耦合**image-projection 必须先于 reasoning-policy 吗？不强制，但管线按注册序执行并在 run 里写 debug 日志（每步输入输出块数），回归时可观测。
- **占位文本提示注入面**attachmentId 来自内部 ID，无用户输入拼接风险；占位文案不包含文件名等用户可控内容（旧版同理）。
- **bot-gateway 直调路径**阶段三的 adapter 断言覆盖所有绕过 L1 的入口；断言错误信息中附 protocol + modelName 便于定位。
- **行为回归**阶段一严格"零行为变化"（除 openai-response 修复，单独标注提交），阶段二才引入新行为，逐阶段可回滚。
