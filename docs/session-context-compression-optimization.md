# 会话上下文压缩优化功能说明

## 概述

本次优化引入了两项核心功能来提升会话上下文压缩的效率和智能性:

1. **智能工具结果清理** (Tool Result Cleaning)
2. **语义轮次分组** (Semantic Turn Grouping)

## 功能特性

### 1. 智能工具结果清理

在触发重量级的 LLM 摘要压缩前,先对工具调用结果进行轻量级清理,显著减少 Token 占用。

#### 清理策略

系统提供三种清理策略,可根据需求选择:

- **激进策略 (aggressive)**
  - 完全移除可再生工具(如知识库检索、联网搜索)的结果
  - 对所有超过 100 字符的工具结果进行精简
  - 适用场景: 需要最大化节省 Token,工具结果可随时重新获取

- **中等策略 (moderate)** - 默认
  - 仅清理可再生工具的结果
  - 对超过 2000 字符的冗长内容进行精简(保留 500 字符)
  - 适用场景: 平衡 Token 节省和信息完整性

- **保守策略 (conservative)**
  - 仅对极长内容(>5000 字符)进行截断(保留 1000 字符)
  - 适用场景: 需要保留尽可能多的原始信息

#### 可再生工具识别

以下工具类型被识别为"可再生"(结果可以重新获取):
- `knowledge_base*` - 知识库相关工具
- `kb_search`, `kb_retrieve` - 知识库搜索/检索
- `web_search`, `search_web` - 联网搜索
- `fetch_url` - URL 抓取
- `retrieve` - 通用检索

### 2. 语义轮次分组

重新定义"对话轮次",将包含多步工具调用的单次用户-助手交互视为一个整体单元。

#### 传统轮次 vs 语义轮次

**传统定义**: 以"是否有工具调用"作为边界
```
User: 查询天气
Assistant (tool_call): search_weather
Tool Response: {temp: 25°C}
Assistant (final): 今天天气不错
→ 这被视为 4 条独立消息
```

**语义轮次定义**: 从用户消息到最终回复为一个整体
```
Turn 1: [User query + tool_call + tool_response + final answer]
→ 这被视为 1 个语义轮次,包含 4 条消息
```

#### 优势

1. **更符合人类对话直觉**: 复杂的多步推理被视为一个整体
2. **更精准的压缩控制**: 可以对包含工具链的轮次应用更激进的清理
3. **避免上下文快速膨胀**: 防止单轮复杂对话占满窗口

## API 使用

### 后端 API

```typescript
POST /sessions/:id/compress-history

Request Body:
{
  "compressionRatio": 50,        // 压缩比例 (0-100)
  "minRetainedTurns": 3,         // 最少保留的语义轮次数
  "cleaningStrategy": "moderate" // 清理策略: 'aggressive' | 'moderate' | 'conservative'
}

Response:
{
  "success": true,
  "compressedTokens": 1500,      // 清理并压缩的 Token 数
  "retainedTokens": 800,         // 保留的 Token 数
  "summary": "生成的摘要内容...",
  "cleaningStrategy": "moderate" // 使用的清理策略
}
```

### 前端调用

```typescript
import { useSessionStore } from '@/stores/session'

const sessionStore = useSessionStore()

// 使用默认策略 (moderate)
await sessionStore.compressSessionHistory(sessionId)

// 自定义策略
await sessionStore.compressSessionHistory(sessionId, {
  compressionRatio: 60,
  minRetainedTurns: 5,
  cleaningStrategy: 'aggressive'
})
```

## 技术实现

### 核心组件

1. **ToolResultCleaner** (`tool-result-cleaner.service.ts`)
   - 负责识别和清理工具结果
   - 实现三种清理级别的逻辑

2. **ContextManagerService** (扩展)
   - 新增 `groupMessagesBySemanticTurns()` 方法
   - 将消息列表按语义轮次分组

3. **SessionService** (修改)
   - `compressHistory()` 方法集成清理逻辑
   - 基于语义轮次计算压缩范围

### 数据流

```
1. 获取新增消息片段
   ↓
2. 按语义轮次分组
   ↓
3. 基于轮次计算压缩范围 (考虑清理后的 Token 数)
   ↓
4. 对要压缩的消息应用清理策略
   ↓
5. 构造 Prompt 并调用 LLM 生成摘要
   ↓
6. 保存摘要和压缩边界
```

## 性能指标

### 预期收益

- **Token 节省**: 
  - 含工具调用的对话: 减少 40-60%
  - 纯文本对话: 减少 10-20%

- **压缩速度**:
  - 清理操作耗时: <50ms
  - 总体压缩时间减少 30-50%

- **上下文利用率**:
  - 平均对话轮次增加 2-3 倍

### 测试覆盖

已创建完整的单元测试:
- `tool-result-cleaner.service.spec.ts` - 11 个测试用例
- `context-manager.semantic-turns.spec.ts` - 7 个测试用例

所有测试均通过 ✓

## 注意事项

### 潜在风险

1. **过度清理导致信息丢失**
   - 应对: 提供三种策略供选择,默认使用中等策略
   - 元数据中保留原始内容长度,便于追溯

2. **语义轮次边界误判**
   - 应对: 严格遵循"用户消息开启新轮次"规则
   - 添加详细日志便于调试

3. **向后兼容性**
   - 新功能是可选的,不传 `cleaningStrategy` 参数时使用默认值
   - 不影响现有压缩流程

### 最佳实践

1. **首次使用建议**:
   - 从 `moderate` 策略开始
   - 观察压缩效果和摘要质量
   - 根据需要调整为 `aggressive` 或 `conservative`

2. **监控指标**:
   - 关注 `compressedTokens` 和 `retainedTokens` 的比例
   - 检查生成的摘要是否保留了关键信息
   - 记录用户对压缩效果的反馈

3. **特殊场景**:
   - 技术讨论: 使用 `conservative` 保留更多细节
   - 日常闲聊: 使用 `aggressive` 最大化节省
   - 混合场景: 使用 `moderate` 取得平衡

## 后续优化方向

1. **自适应清理**: 基于对话主题自动调整策略
2. **增量压缩**: 仅对新产生的工具结果进行清理
3. **用户反馈循环**: 允许用户标记重要内容不被清理
4. **多模态支持**: 扩展到图片、音频等多媒体内容

## 相关文件

- `backend-ts/src/modules/chat/tool-result-cleaner.service.ts` - 清理器服务
- `backend-ts/src/modules/chat/types/semantic-turn.types.ts` - 语义轮次类型定义
- `backend-ts/src/modules/chat/context-manager.service.ts` - 上下文管理器(已扩展)
- `backend-ts/src/modules/chat/session.service.ts` - 会话服务(已修改)
- `backend-ts/src/modules/chat/sessions.controller.ts` - 控制器(已更新)
- `frontend/src/services/ApiService.ts` - 前端 API 服务(已更新)
- `frontend/src/stores/session.ts` - 前端状态管理(已更新)

## 测试文件

- `backend-ts/src/modules/chat/tool-result-cleaner.service.spec.ts`
- `backend-ts/src/modules/chat/context-manager.semantic-turns.spec.ts`
