# 会话标题生成功能实现文档

## 概述

本文档描述了 TypeScript 后端中会话标题生成功能的实现，该功能参考了 Python 后端的实现逻辑。

## 功能说明

会话标题生成功能会自动为新创建的会话生成一个简洁、准确的标题，基于会话中的前几条消息内容。

## 实现细节

### 1. 核心服务

- **SessionService**: 主要服务类，包含 `generateTitle` 方法
- **MemoryManagerService**: 负责获取最近的对话消息
- **LLMService**: 调用大语言模型生成标题
- **ModelRepository**: 获取模型配置信息
- **GlobalSettingRepository**: 获取全局设置

### 2. 工作流程

1. **验证会话**: 检查会话是否存在且属于当前用户
2. **获取模型配置**: 从全局设置中获取 `default_title_summary_model_id`
3. **获取上下文消息**: 使用 MemoryManagerService 获取最近 3 条非系统消息
4. **构建提示词**: 结合用户和助手消息构建标题生成提示词
5. **调用 LLM**: 使用低温度 (0.3) 和限制 token (50) 生成标题
6. **更新数据库**: 将生成的标题保存到会话记录中
7. **返回结果**: 返回包含新标题和状态的对象

### 3. 跳过条件

在以下情况下会跳过标题生成：

- 未配置默认标题生成模型 (`no_title_model_configured`)
- 会话中非系统消息少于 2 条 (`insufficient_messages`)
- 指定的模型不存在 (`title_model_not_found`)
- 缺少用户或助手消息 (`missing_messages`)
- LLM 生成失败 (`generation_failed`)
- 发生错误 (`error`)

### 4. 返回格式

```typescript
{
  title: string;        // 生成的标题或原标题
  skipped: boolean;     // 是否跳过生成
  reason?: string;      // 跳过原因（如果跳过）
  old_title?: string;   // 原标题（如果成功生成）
  error?: string;       // 错误信息（如果出错）
}
```

## 配置要求

需要在全局设置中配置以下项：

- `default_title_summary_model_id`: 用于生成标题的模型 ID
- `default_title_summary_prompt`: 标题生成提示词模板（可选，有默认值）

## 代码位置

- 主服务: `src/modules/chat/session.service.ts`
- 记忆管理: `src/modules/chat/memory.service.ts`
- LLM 服务: `src/modules/chat/llm.service.ts`
- 测试文件: `src/modules/chat/session.service.spec.ts`

## 测试

运行测试命令：

```bash
npm test -- session.service.spec.ts
```

测试覆盖了以下场景：
- 未配置模型时跳过
- 消息不足时跳过
- 成功生成标题

## 与 Python 后端的对应关系

| Python 后端 | TypeScript 后端 | 说明 |
|------------|----------------|------|
| `session_service.py::generate_title` | `session.service.ts::generateTitle` | 主逻辑 |
| `memory_manager_service.py::get_recent_messages_for_summary` | `memory.service.ts::getRecentMessagesForSummary` | 获取消息 |
| `llm_service.py::completions` | `llm.service.ts::completionsNonStream` | LLM 调用 |
| `setting_service.get()` | `globalSettingRepo.findByKey()` | 获取设置 |

## 注意事项

1. 该方法应在会话创建后异步调用，避免阻塞主流程
2. 使用了较低的 temperature (0.3) 以确保输出稳定
3. 限制了 max_tokens (50) 以控制输出长度
4. 所有错误都被捕获并返回跳过状态，确保不会影响用户体验
