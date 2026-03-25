# 自动会话标题生成 - 测试指南

## 功能概述

自动会话标题生成功能会在用户完成第一轮对话后，自动调用 LLM 生成一个简洁、准确的会话标题。

## 实现的功能点

### 后端

1. **API 端点**: `POST /api/v1/sessions/{session_id}/generate-title`
   - 独立于聊天 API，不会阻塞正常对话流程
   - 返回生成的标题或跳过原因

2. **服务层方法**: `SessionService.generate_session_title()`
   - 验证会话所有权
   - 检查模型配置
   - 获取前两条消息（用户 + 助手）
   - 使用全局设置的标题总结模型和提示词
   - 调用 LLM 生成标题并更新会话

3. **智能判断逻辑**:
   - ✅ 未配置全局标题模型 → 跳过生成
   - ✅ 消息不足 2 条 → 跳过生成
   - ✅ 标题模型不存在 → 跳过生成
   - ✅ LLM 调用失败 → 跳过生成并记录日志

### 前端

1. **API 调用方法**: `ApiService.generateSessionTitle(sessionId)`
   - 封装后端 API 调用

2. **ChatPanel 组件集成**:
   - 监听 `isStreaming` 状态变化（从 true 到 false）
   - 检测第一条助手消息生成完成
   - 调用标题生成 API
   - 实时更新 UI 显示新标题
   - 使用 `hasGeneratedTitle` 标记避免重复调用

3. **状态管理**: 
   - `sessionStore.updateSessionTitle()` 统一更新标题
   - 确保多个组件间标题同步

4. **会话切换处理**:
   - 切换会话时重置 `hasGeneratedTitle` 标记
   - 允许每个会话独立生成标题

## 测试步骤

### 前置条件

1. **启动后端服务**
   ```bash
   cd backend
   python -m uvicorn app.main:app --reload
   ```

2. **启动前端服务**
   ```bash
   cd frontend
   npm run dev
   ```

3. **配置全局设置**
   - 登录系统
   - 进入设置页面
   - **必须配置** `default_title_summary_model_id`（默认标题总结模型）
   - 可选配置 `default_title_summary_prompt`（有默认值）

**重要说明**:
- ⚠️ 标题生成**不使用**会话的 `model_id`
- ✅ 始终从全局设置中读取 `default_title_summary_model_id`
- ✅ 如果未配置全局标题模型，则跳过生成

### 测试场景 1：正常流程

**目标**: 验证标题生成功能正常工作

**步骤**:
1. 创建一个新的会话（确保会话配置了 model_id）
2. 发送第一条用户消息，例如："如何使用 Python 读取 CSV 文件？"
3. 等待助手回复完成（流式输出结束）
4. 观察界面右上角的会话标题

**预期结果**:
- ✅ 助手回复完成后 1-2 秒内，标题自动更新
- ✅ 显示成功通知："标题已更新" + 新标题内容
- ✅ 新标题简洁、准确且与对话内容相关
- ✅ 刷新页面后标题保持不变

**验证方法**:
```javascript
// 在浏览器控制台查看网络请求
// 应该看到 POST /api/v1/sessions/{session_id}/generate-title 请求
// 响应示例：
{
  "title": "Python CSV 文件读取方法",
  "skipped": false,
  "old_title": "原始标题"
}
```

### 测试场景 2：未配置模型

**目标**: 验证当会话未配置模型时正确跳过标题生成

**步骤**:
1. 创建一个会话，不设置 model_id（或者角色的 model_id 为 null）
2. 发送一条消息
3. 等待助手回复完成

**预期结果**:
- ✅ 不触发标题生成 API 调用
- ✅ 会话标题保持初始值
- ✅ 后端日志显示："Session {id} has no model configured, skipping title generation"

**验证方法**:
```bash
# 查看后端日志
grep "skipping title generation" backend.log
```

### 测试场景 3：消息不足

**目标**: 验证当消息数量不足时正确处理

**步骤**:
1. 创建一个新会话
2. 不调用聊天 API，直接调用标题生成 API
   ```bash
   curl -X POST http://localhost:8000/api/v1/sessions/{session_id}/generate-title \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

**预期结果**:
- ✅ 返回响应：`{"title": "原始标题", "skipped": true, "reason": "insufficient_messages"}`
- ✅ 标题不更新

### 测试场景 4：LLM 调用失败

**目标**: 验证当 LLM 服务不可用时的错误处理

**步骤**:
1. 配置一个无效的模型 ID
2. 发送消息并等待回复
3. 观察标题生成行为

**预期结果**:
- ✅ 前端不显示错误提示（避免影响用户体验）
- ✅ 后端日志记录详细错误信息
- ✅ 返回响应包含错误原因

### 测试场景 5：会话切换

**目标**: 验证切换会话时标题生成标记正确重置

**步骤**:
1. 在会话 A 中发送第一条消息，等待回复完成
2. 切换到会话 B
3. 在会话 B 中发送第一条消息，等待回复完成

**预期结果**:
- ✅ 会话 A 的标题已生成
- ✅ 会话 B 的标题也已生成
- ✅ 两个会话的标题互不影响

## 日志检查

### 后端日志示例

**成功生成标题**:
```
INFO: Using global title model {model_id}
INFO: Successfully generated title 'Python CSV 文件读取方法' for session {session_id}
```

**跳过标题生成**:
```
INFO: No default title summary model configured in settings, skipping title generation
INFO: Session {session_id} has less than 2 messages, skipping title generation
ERROR: Title model {model_id} not found in settings
```

**错误处理**:
```
ERROR: Error generating title for session {session_id}: Connection timeout
Traceback (most recent call last):
  ...
```

## 常见问题排查

### 问题 1: 标题没有自动生成

**可能原因**:
- 全局设置中未配置 `default_title_summary_model_id` ⚠️ **这是最常见的原因**
- 消息数量不足 2 条
- 标题模型不存在
- LLM 服务调用失败

**排查步骤**:
1. **首先检查全局设置**：确认已配置 `default_title_summary_model_id`
2. 检查后端日志，查看是否显示 "No default title summary model configured"
3. 查看浏览器控制台网络请求
4. 检查后端日志查看详细错误

### 问题 2: 标题重复生成

**可能原因**:
- `hasGeneratedTitle` 标记未正确设置
- 页面刷新导致状态丢失

**排查步骤**:
1. 检查 ChatPanel.vue 中的 watch 逻辑
2. 确认切换会话时重置了标记

### 问题 3: 标题更新但 UI 未刷新

**可能原因**:
- sessionStore 未正确更新
- 组件未监听到状态变化

**排查步骤**:
1. 检查 `sessionStore.updateSessionTitle()` 调用
2. 检查 currentSession 的计算属性

## 性能优化建议

1. **防抖处理**: 如果频繁切换会话，可以考虑添加防抖
2. **缓存机制**: 可以缓存已生成的标题，避免重复调用 LLM
3. **超时控制**: LLM 调用应设置合理的超时时间（建议 5-10 秒）
4. **并发控制**: 同一会话不应同时发起多个标题生成请求

## 下一步改进方向

1. ✨ 支持用户自定义标题生成提示词
2. ✨ 支持手动触发重新生成标题
3. ✨ 提供多个标题候选供用户选择
4. ✨ 记录标题生成历史
5. ✨ 支持关闭自动标题生成功能

## 相关文档

- [功能实现文档](./AUTO_TITLE_GENERATION_FEATURE.md)
- [测试脚本](./test_auto_title_generation.py)
