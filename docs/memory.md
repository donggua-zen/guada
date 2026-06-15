# 长期记忆 (上下文管理与压缩)

GuaDa 的对话记忆系统采用 **两级压缩策略**（优先裁剪工具结果→再语义压缩），在 Token 限制与信息保真之间取得平衡，且压缩**非破坏性、可逆**。

## 架构

```
PersistentSessionContext (会话上下文)
    ├── loadConversationState()   → 加载历史 + 检查点恢复
    ├── getMessages()             → 构建发送给 LLM 的消息列表
    ├── appendParts()             → 追加新消息
    ├── forceCompress()           → 主动触发压缩
    └── persist()                 → 持久化到数据库

CompressionStrategy (压缩策略)
    ├── 丢弃模式     → direct discard
    ├── 快速压缩     → single LLM call
    └── 迭代压缩     → iterative (最多 3 轮)
```

## 与传统方案的区别

| 特性 | GuaDa | 传统方案 |
|------|-------|----------|
| **可编辑** | AI 摘要不准确时可手动修改 | 不可编辑 |
| **可回退** | 删除压缩记录，自动还原历史 | 不可回退 |
| **有历史** | 所有压缩记录可见可回溯 | 无历史记录 |
| **保护机制** | 最近 5 条 + 最新 3 条工具结果免裁 | 无保护 |

## 压缩模式

| 模式 | 工作机制 | 适用场景 |
|------|----------|----------|
| **丢弃** | 直接丢弃超出的旧消息 | 对历史无要求、Token 极度紧张 |
| **快速压缩** | 单次 LLM 调用生成摘要 | Token 即将耗尽，需快速回收 |
| **迭代压缩** | Agent 自检优化，最多 3 轮 | 默认模式，质量优先 |

默认 `iterative`，失败自动回退到 `fast`。

## 配置项

```typescript
interface MemoryConfig {
  maxMemoryLength?: number;       // 最大保留消息数
  compressionTriggerRatio: number; // 触发压缩阈值（默认 0.8）
  compressionTargetRatio: number;  // 压缩目标比例（默认 0.5）
  summaryMode: string;             // fast | iterative
  maxTokensLimit?: number;         // 可选硬性上限
}
```

- `compressionTriggerRatio = 0.8`：上下文窗口使用达 80% 时触发压缩
- `compressionTargetRatio = 0.5`：压缩到上下文窗口的 50%
- 保护：最近 5 条消息强制保留，最新 3 条工具结果不裁剪

## 检查点系统

### 检查点持久化

每次压缩后创建检查点，记录压缩位置。会话初始化时通过 `getCheckpoint()` 加载，`preprocess()` 根据检查点重建历史消息与摘要的混合列表。

### 两级压缩策略

1. **第一级（裁剪工具结果）**：优先裁剪工具角色的响应内容，保留助手消息和关键对话
2. **第二级（语义压缩）**：仍超限时，对旧消息进行 LLM 摘要，用摘要替代原始消息

### 消息加载

`getMessages()` 构建最终发送给 LLM 的消息列表：
```
System Prompt (含技能元数据 + 工具提示词)
    + 摘要消息（如有检查点）
    + 历史消息（保留最近对话）
    + 当前轮次消息
    + 工具提示词
```

## 模型兼容处理

针对不同模型特性，加载对话状态时做特殊处理：

| 模型 | 处理逻辑 |
|------|----------|
| **DeepSeek-V4** | 有工具调用时保留所有 reasoningContent，否则移除 |
| **其他推理模型** | 只保留最后一条用户消息之后的 reasoningContent |
| **Kimi** | 空的 assistant content 替换为 `\n` |

## Token 计数

使用 `@huggingface/tokenizers` 进行精准 Token 计数：
- `systemPromptTokenCount`：System Prompt 的 Token 数，从上下文窗口中扣除
- `currentTokenCount`：当前历史消息的 Token 数，压缩触发的依据
- `getTokenCount()`：返回 `currentTokenCount + systemPromptTokenCount`
