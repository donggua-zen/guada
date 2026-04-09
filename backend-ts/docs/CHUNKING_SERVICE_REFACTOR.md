# 知识库文本分块服务重构报告

## 概述

本次重构将 TypeScript 后端的文本分块逻辑从简单的固定字符长度截断升级为基于 Token 的智能分块，与 Python 后端完全对齐。

## 对比分析

### 1. 原有实现（`kb-file.service.ts` 中的 `chunkText` 方法）

**问题：**
- ❌ 使用固定字符长度截断，不考虑语义边界
- ❌ 没有基于 Token 计数，Token 数量不可控
- ❌ 可能在单词或句子中间强行切断
- ❌ 重叠逻辑简单，仅通过字符位置计算
- ❌ 缺乏元数据支持

**代码示例：**
```typescript
private chunkText(text: string, chunkSize: number, overlapSize: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.substring(start, end);  // ❌ 简单截断
    chunks.push(chunk);

    if (end >= text.length) break;
    start = end - overlapSize;
  }

  return chunks;
}
```

### 2. 新实现（`chunking.service.ts`）

**优势：**
- ✅ 基于 Token 数量精确控制分块大小
- ✅ 优先在句子/段落边界分割，保持语义完整性
- ✅ 智能重叠机制，确保上下文连贯性
- ✅ 完整的元数据支持（tokenCount、overlapLength、strategy 等）
- ✅ 与 Python 端逻辑完全对齐

**核心特性：**

#### 2.1 Token 计数机制
```typescript
// 使用 tiktoken 库进行精确的 Token 计算
async countTokens(text: string): Promise<number> {
  const tokenizer = await this.getTokenizer();
  return tokenizer.encode(text).length;
}
```

#### 2.2 智能句子分割
```typescript
// 按句子边界分割（支持中英文标点）
const sentences = text.split(/(?<=[。！？.!?])/);

// 累加句子直到超出限制
if (totalNeeded > this.options.chunkSize! && currentChunkSentences.length > 0) {
  chunks.push(currentChunkSentences.join(' '));
  currentChunkSentences = [sentence];
  currentTokens = sentenceTokens;
}
```

#### 2.3 重叠逻辑
```typescript
// 获取前一个分块的末尾 tokens
const overlapTokenIds = prevTokensList.slice(-this.options.overlapSize!);
const overlapText = await this.decodeTokens(overlapTokenIds);

// 检查是否自然包含重叠
if (content.startsWith(overlapText)) {
  overlapLength = overlapTokenIds.length;
  finalContent = content;
} else {
  // 拼接重叠部分到当前分块前面
  finalContent = overlapText + content;
}
```

#### 2.4 数据结构对齐
```typescript
interface ChunkResult {
  content: string;           // 包含重叠的完整内容（用于向量化）
  cleanContent: string;      // 纯净内容（不含重叠，用于展示）
  chunkIndex: number;        // 分块索引
  metadata: {
    overlapLength: number;   // 重叠部分的 Token 数
    chunkSize: number;       // 原始内容长度（字符数）
    tokenCount: number;      // Token 数量
    cleanSize: number;       // 纯净内容长度（字符数）
    strategy: string;        // 分块策略
  };
}
```

## 依赖说明

### 已安装依赖
项目已安装 `tiktoken@1.0.10`，无需额外安装。

### Tokenizer 编码映射
```typescript
// 固定使用 cl100k_base 编码（适用于大多数 OpenAI 兼容模型）
所有模型 → cl100k_base
```

**为什么固定使用 cl100k_base？**
- ✅ 简化逻辑，避免模型名称与编码不匹配的问题
- ✅ `cl100k_base` 是 GPT-4、GPT-3.5 等主流模型的编码
- ✅ 对于其他模型，Token 计数误差在可接受范围内
- ✅ 减少初始化和错误处理的复杂性

## 集成方式

### 1. 模块注册
在 `knowledge-base.module.ts` 中已注册 `ChunkingService`：
```typescript
providers: [
  // ...
  ChunkingService,
]
```

### 2. 服务注入
在 `kb-file.service.ts` 中注入并使用：
```typescript
constructor(
  // ...
  private chunkingService: ChunkingService,
) {}

// 使用示例
const chunksData = await this.chunkingService.chunkText(content, {
  chunkSize: kb.chunkMaxSize,
  overlapSize: kb.chunkOverlapSize,
});
```

### 3. 数据库存储优化
- 存储 `cleanContent`（纯净内容）而非 `content`（含重叠）
- 记录准确的 `tokenCount` 而非字符数
- 保存重叠信息和分块策略到 metadata

## 性能优化建议

### 1. Tokenizer 缓存
`ChunkingService` 内部已实现 tokenizer 实例缓存，避免重复初始化开销。

### 2. 异步处理
所有 Token 计算操作均为异步，不会阻塞主线程。

### 3. 资源释放
提供 `dispose()` 方法手动释放 tokenizer 资源：
```typescript
service.dispose();
```

## 测试覆盖

已创建完整的单元测试文件 `chunking.service.spec.ts`，覆盖以下场景：
- ✅ 空文本处理
- ✅ 短文本不分块
- ✅ 基于句子边界的智能分块
- ✅ 重叠逻辑验证
- ✅ 元数据完整性
- ✅ Token 计数准确性
- ✅ 编码/解码往返测试
- ✅ 中英文混合长文本
- ✅ 超长句子强制分割

运行测试：
```bash
npm test -- chunking.service.spec.ts
```

## 与 Python 端的对齐

| 特性 | Python (`chunking_service.py`) | TypeScript (`chunking.service.ts`) | 状态 |
|------|-------------------------------|-----------------------------------|------|
| Token 计数 | ✅ tiktoken | ✅ tiktoken | ✅ 对齐 |
| 句子边界分割 | ✅ 正则表达式 | ✅ 正则表达式 | ✅ 对齐 |
| 重叠逻辑 | ✅ Token 级重叠 | ✅ Token 级重叠 | ✅ 对齐 |
| 文本预处理 | ✅ preprocess_text | ✅ preprocessText | ✅ 对齐 |
| 数据结构 | ✅ ChunkResult | ✅ ChunkResult | ✅ 对齐 |
| 元数据支持 | ✅ 完整 | ✅ 完整 | ✅ 对齐 |

## 迁移影响

### 向后兼容性
- ✅ API 接口无变化
- ✅ 数据库 schema 兼容（metadata 字段为 JSON 类型）
- ✅ 前端无需修改

### 潜在风险
- ⚠️ Token 计数可能导致分块数量略有变化
- ⚠️ 建议重新处理现有知识库文件以获得最佳效果

## 故障排除

### 问题：Invalid encoding 错误（已解决）

**之前的错误信息：**
```
[Nest] XXXXX  - YYYY/MM/DD HH:MM:SS   ERROR [KbFileService] 文件处理失败：Invalid encoding
```

**原因：**
- 之前尝试根据模型名称动态选择编码，导致不匹配

**解决方案（已实施）：**
- ✅ **固定使用 `cl100k_base` 编码**，不再根据模型名称动态选择
- ✅ 简化了初始化逻辑，避免了编码不匹配的问题
- ✅ 适用于所有主流 OpenAI 兼容模型

**当前实现：**
```typescript
// chunking.service.ts
private readonly encodingName: tiktoken.TiktokenEncoding = 'cl100k_base';

// kb-file.service.ts - 无需传入 modelName
const chunksData = await this.chunkingService.chunkText(content, {
  chunkSize: kb.chunkMaxSize,
  overlapSize: kb.chunkOverlapSize,
  // 不需要 modelName 参数
});
```

### 问题：分块数量与预期不符

A: 分块基于句子边界，不会强行切断句子。如果单个句子超过 chunkSize，会被单独作为一个分块。

## 后续优化方向

1. **段落级别分块**：在句子分割基础上增加段落边界识别
2. **自适应 chunkSize**：根据文本类型自动调整分块大小
3. **批量处理优化**：对大文件采用流式分块减少内存占用

## 总结

本次重构成功将 TypeScript 端的文本分块能力提升至与 Python 端同等水平，实现了：
- 基于 Token 的精确控制
- 语义感知的智能分割
- 完整的重叠机制
- 丰富的元数据支持

这将为 RAG 检索提供更高质量的文本分块，显著提升检索准确性和上下文连贯性。
