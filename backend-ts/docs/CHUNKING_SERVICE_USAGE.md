# ChunkingService 使用指南

## 快速开始

### 基本用法

```typescript
import { ChunkingService } from './modules/knowledge-base/chunking.service';

// 创建服务实例（固定使用 cl100k_base 编码）
const chunkingService = new ChunkingService({
  chunkSize: 1000,      // Token 数
  overlapSize: 100,     // Token 数
});

// 分块文本
const text = '这是需要分块的文本内容...';
const chunks = await chunkingService.chunkText(text, {
  chunkSize: 800,
  overlapSize: 80,
});

// 访问分块结果
chunks.forEach(chunk => {
  console.log('分块索引:', chunk.chunkIndex);
  console.log('纯净内容:', chunk.cleanContent);
  console.log('完整内容（含重叠）:', chunk.content);
  console.log('Token 数量:', chunk.metadata.tokenCount);
  console.log('重叠长度:', chunk.metadata.overlapLength);
});

// 释放资源
chunkingService.dispose();
```

### 自定义元数据

```typescript
const metadata = {
  fileId: 'file-123',
  knowledgeBaseId: 'kb-456',
  fileName: 'document.pdf',
};

const chunks = await chunkingService.chunkText(text, metadata);

// 元数据会合并到每个分块中
console.log(chunks[0].metadata.fileId); // 'file-123'
```

## API 参考

### ChunkingService

#### 构造函数

```typescript
constructor(options?: ChunkingOptions)
```

**参数：**
- `options.chunkSize`: 分块大小限制（Token 数），默认 1000
- `options.overlapSize`: 分块重叠大小（Token 数），默认 100
- `options.modelName`: 用于计算 Token 的模型名称，默认 'gpt-4o'

#### 方法

##### chunkText

对文本进行基于 Token 的智能分块。

```typescript
async chunkText(
  text: string,
  options?: ChunkTextOptions,
  metadata?: Record<string, any>
): Promise<ChunkResult[]>
```

**参数：**
- `text`: 待分块的文本
- `options`: 可选的分块选项，会合并到构造函数的默认值
  - `chunkSize`: 分块大小（Token 数）
  - `overlapSize`: 重叠大小（Token 数）
  - `modelName`: 已废弃，仅保留兼容性（固定使用 cl100k_base）
- `metadata`: 可选的元数据，会合并到每个分块的 metadata 中

**返回：**
- `ChunkResult[]`: 分块结果数组

**示例：**
```typescript
// 方式1：只传 metadata
const chunks1 = await chunkingService.chunkText(text, {
  fileId: 'file-123',
  knowledgeBaseId: 'kb-456',
});

// 方式2：传 options 和 metadata
const chunks2 = await chunkingService.chunkText(text, {
  chunkSize: 800,
  overlapSize: 80,
}, {
  fileId: 'file-123',
});
```

**注意：** `modelName` 参数已废弃，服务固定使用 `cl100k_base` 编码进行 Token 计数。

##### countTokens

计算文本的 Token 数量。

```typescript
async countTokens(text: string): Promise<number>
```

**示例：**
```typescript
const tokenCount = await chunkingService.countTokens('Hello world!');
console.log(tokenCount); // 例如: 3
```

##### encodeText

将文本编码为 Token ID 列表。

```typescript
async encodeText(text: string): Promise<number[]>
```

**示例：**
```typescript
const tokens = await chunkingService.encodeText('测试');
console.log(tokens); // [1234, 5678]
```

##### decodeTokens

将 Token ID 列表解码为文本。

```typescript
async decodeTokens(tokenIds: number[]): Promise<string>
```

**示例：**
```typescript
const text = await chunkingService.decodeTokens([1234, 5678]);
console.log(text); // '测试'
```

##### dispose

释放 tokenizer 资源。

```typescript
dispose(): void
```

**示例：**
```typescript
// 使用完毕后释放资源
chunkingService.dispose();
```

## 数据类型

### ChunkResult

```typescript
interface ChunkResult {
  content: string;           // 包含重叠的完整内容（用于向量化）
  cleanContent: string;      // 纯净内容（不含重叠，用于展示）
  chunkIndex: number;        // 分块索引（从 0 开始）
  metadata: {
    overlapLength: number;   // 重叠部分的 Token 数
    chunkSize: number;       // 原始内容长度（字符数）
    tokenCount: number;      // Token 数量
    cleanSize: number;       // 纯净内容长度（字符数）
    strategy: string;        // 分块策略（固定为 'token'）
    // ... 其他自定义字段
  };
}
```

### ChunkingOptions

```typescript
interface ChunkingOptions {
  chunkSize?: number;        // 分块大小限制（Token 数）
  overlapSize?: number;      // 分块重叠大小（Token 数）
  modelName?: string;        // 用于计算 Token 的模型名称
}
```

## 高级用法

### 在 NestJS 服务中使用

```typescript
import { Injectable } from '@nestjs/common';
import { ChunkingService } from './chunking.service';

@Injectable()
export class MyService {
  constructor(private chunkingService: ChunkingService) {}

  async processDocument(text: string) {
    // 直接注入使用，无需手动管理生命周期
    const chunks = await this.chunkingService.chunkText(text, {
      chunkSize: 1000,
      overlapSize: 100,
    });

    return chunks;
  }
}
```

### 批量处理多个文档

```typescript
const documents = [
  { id: 'doc1', text: '文档1内容...' },
  { id: 'doc2', text: '文档2内容...' },
];

const allChunks = [];

for (const doc of documents) {
  const chunks = await chunkingService.chunkText(doc.text, {
    documentId: doc.id,
  });
  
  allChunks.push(...chunks);
}

console.log(`总共生成 ${allChunks.length} 个分块`);
```

### 自定义分块策略

```typescript
// 小分块 + 大重叠（适合精细检索）
const fineChunks = await chunkingService.chunkText(text, {
  chunkSize: 500,
  overlapSize: 150,
});

// 大分块 + 小重叠（适合上下文理解）
const coarseChunks = await chunkingService.chunkText(text, {
  chunkSize: 2000,
  overlapSize: 50,
});
```

### 与向量数据库集成

```typescript
import { VectorDatabase } from '../../common/vector-db/interfaces/vector-database.interface';

async function indexDocument(
  text: string,
  kbId: string,
  fileId: string,
  vectorDb: VectorDatabase,
  chunkingService: ChunkingService,
  embeddingService: EmbeddingService
) {
  // 1. 分块
  const chunksData = await chunkingService.chunkText(text, {
    chunkSize: 1000,
    overlapSize: 100,
  });

  // 2. 提取内容用于向量化
  const contents = chunksData.map(chunk => chunk.content);

  // 3. 生成向量
  const embeddings = await embeddingService.getEmbeddings(
    contents,
    apiUrl,
    apiKey,
    modelName
  );

  // 4. 存储到向量数据库
  const tableId = `kb_${kbId}`;
  const documents = chunksData.map((chunk, idx) => ({
    id: `chunk_${idx}_${fileId}`,
    documentId: fileId,
    content: chunk.content,
    embedding: embeddings[idx],
    metadata: {
      knowledgeBaseId: kbId,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.metadata.tokenCount,
      overlapLength: chunk.metadata.overlapLength,
    },
  }));

  await vectorDb.addDocuments(tableId, documents);

  return chunksData.length;
}
```

## 最佳实践

### 1. 选择合适的 chunkSize

- **代码文档**: 500-800 tokens（保持函数/类的完整性）
- **技术文档**: 800-1200 tokens（平衡精度和上下文）
- **通用文本**: 1000-1500 tokens（标准设置）
- **长篇文章**: 1500-2000 tokens（保留更多上下文）

### 2. 设置合理的 overlapSize

- **一般场景**: chunkSize 的 10-15%
- **高精度需求**: chunkSize 的 15-20%
- **性能优先**: chunkSize 的 5-10%

### 3. 资源管理

```typescript
// ✅ 推荐：在模块销毁时释放资源
export class MyModule implements OnModuleDestroy {
  constructor(private chunkingService: ChunkingService) {}

  onModuleDestroy() {
    this.chunkingService.dispose();
  }
}

// ❌ 避免：频繁创建和销毁实例
for (let i = 0; i < 100; i++) {
  const service = new ChunkingService(); // 开销大
  await service.chunkText(text);
  service.dispose();
}
```

### 4. 错误处理

```typescript
try {
  const chunks = await chunkingService.chunkText(text);
  
  if (chunks.length === 0) {
    console.warn('文本为空或无法分块');
    return;
  }
  
  // 处理分块...
} catch (error) {
  console.error('分块失败:', error.message);
  // 降级处理或使用默认分块策略
}
```

## 常见问题

### Q: 为什么分块数量与预期不符？

A: 分块基于句子边界，不会强行切断句子。如果单个句子超过 chunkSize，会被单独作为一个分块。

### Q: overlapLength 为 0 是什么意思？

A: 表示该分块与前一个分块没有重叠（通常是第一个分块，或者前一个分块末尾自然衔接）。

### Q: content 和 cleanContent 有什么区别？

A: 
- `content`: 包含重叠部分，用于向量和检索
- `cleanContent`: 纯净内容，用于展示和存储

### Q: 支持哪些模型？

A: 目前支持所有 OpenAI 兼容的模型（通过 tiktoken 编码映射）。可以通过扩展 `getEncodingForModel` 方法添加更多模型支持。

## 故障排除

### 问题：Tokenizer 初始化失败

**解决方案：**
```typescript
// 确保 tiktoken 已正确安装
npm list tiktoken

// 检查编码名称是否正确
const service = new ChunkingService({
  modelName: 'gpt-4o', // 使用支持的模型名称
});
```

### 问题：内存占用过高

**解决方案：**
```typescript
// 1. 及时释放资源
service.dispose();

// 2. 分批处理大文件
const batchSize = 10;
for (let i = 0; i < texts.length; i += batchSize) {
  const batch = texts.slice(i, i + batchSize);
  // 处理批次...
  await new Promise(resolve => setTimeout(resolve, 100)); // 短暂暂停
}
```

### 问题：分块结果不理想

**解决方案：**
```typescript
// 调整 chunkSize 和 overlapSize
const chunks = await chunkingService.chunkText(text, {
  chunkSize: 800,   // 尝试减小
  overlapSize: 120, // 增加重叠
});

// 检查文本预处理
const preprocessed = service['preprocessText'](text);
console.log('预处理后:', preprocessed.substring(0, 200));
```

## 参考资料

- [tiktoken GitHub](https://github.com/openai/tiktoken)
- [OpenAI Tokenizer](https://platform.openai.com/tokenizer)
- [Python ChunkingService](../../../backend/app/services/chunking_service.py)
