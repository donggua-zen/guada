# 流式 Chunk 日志记录与重放测试

## 功能说明

该功能用于调试流式输出限流逻辑，通过记录原始 LLM chunk 并按时间重放，可以精确分析限流效果和排查问题。

## 使用方法

### 1. 启用日志记录

日志记录默认已启用（`ENABLE_RAW_CHUNK_LOG = true`）。每次执行 LLM 流式请求时，会自动在以下位置生成日志文件：

```
backend-ts/test-logs/raw-chunks/latest-chunks.jsonl
```

**特点**：
- 该文件是固定名称，采用**追加模式**，不会覆盖旧内容
- 一次问答的所有轮次都会写入同一个文件
- 每个新的 LLM 请求会用分隔线标记：`=== REQUEST START at {timestamp} ===`
- 方便查看完整的多轮对话 chunk 数据

每条日志记录的格式：
```json
{"timestamp":123,"chunk":{"content":"Hello","reasoningContent":null,...}}
```

其中 `timestamp` 是相对于请求开始的毫秒数。

### 2. 验证 Chunk 完整性

运行测试脚本验证提取的 chunk 数据是否完整：

```bash
cd backend-ts
npx ts-node test/validate-chunks.ts
```

或者指定特定的日志文件：

```bash
npx ts-node test/validate-chunks.ts test-logs/raw-chunks/latest-chunks.jsonl
```

**测试内容**：
- ✅ Chunk 数量统计（content、reasoning、toolCalls、finishReason）
- ✅ ToolCalls 完整性检查（id、name、arguments）
- ✅ 时间戳连续性验证
- ✅ 时间分布分析（平均间隔、最大/最小间隔、标准差）

**示例输出**：
```
=== Chunk 数据完整性测试 ===

日志文件: test-logs/raw-chunks/latest-chunks.jsonl

✅ 加载了 45 个 chunk

📊 Chunk 统计:
  总数: 45
  含 content: 12
  含 reasoning: 8
  含 toolCalls: 15
  含 finishReason: 2

⏱️  时间分布:
  平均间隔: 23.45ms
  最大间隔: 156ms
  最小间隔: 2ms
  标准差: 18.67ms
  中位数: 15ms

✅ 所有验证通过！
```

## 调试流程

1. **复现问题**：执行会导致问题的对话操作
2. **查看日志**：打开 `test-logs/raw-chunks/latest-chunks.jsonl` 文件
3. **运行测试**：直接运行 `npx ts-node test/validate-chunks.ts`（无需指定文件）
4. **定位问题**：根据测试结果判断是否有 chunk 丢失或 toolCall 不完整
5. **修复代码**：修改 `agent-engine.service.ts` 中的 `throttledStream` 方法
6. **验证修复**：重新测试，确保所有验证通过

## 注意事项

- 日志文件会在每次请求开始时清空，确保只记录当前请求的 chunk
- 生产环境建议关闭日志记录（设置 `ENABLE_RAW_CHUNK_LOG = false`）以避免性能影响
- JSONL 格式便于逐行解析，可以使用 `jq` 等工具进行进一步分析

## 高级用法

### 自定义速度重放

可以修改 `replayChunks` 函数的 `speedFactor` 参数来调整重放速度：

```typescript
// 2倍速重放
const stream = replayChunks(entries, 2.0);

// 半速重放
const stream = replayChunks(entries, 0.5);
```

### 手动分析日志

使用命令行工具快速查看日志：

```bash
# 查看前10条记录
head -n 10 test-logs/raw-chunks/latest-chunks.jsonl | jq .

# 统计 tool_call 类型的 chunk 数量
grep '"toolCalls"' test-logs/raw-chunks/latest-chunks.jsonl | wc -l

# 提取所有 toolCalls
jq 'select(.chunk.toolCalls != null) | .chunk.toolCalls' test-logs/raw-chunks/latest-chunks.jsonl
```
