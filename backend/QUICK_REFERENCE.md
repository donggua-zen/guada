# 会话继承角色功能 - 快速参考

## 变更总结

| 组件 | 变更类型 | 描述 |
|------|---------|------|
| **Session 模型** | 新增字段 | `character_id` (外键) |
| **SessionCreate** | 必填字段 | `character_id` 现在必须提供 |
| **SessionOut** | 新增字段 | `character_id`, `character` |
| **create_session** | 逻辑重构 | 继承 + 选择性覆盖，不再完整复制 |
| **前端创建会话** | 强制验证 | 必须先选择角色才能创建会话 |

## 核心代码位置

### 后端
- 模型：`backend/app/models/session.py`
- Schema: `backend/app/schemas/session.py`
- 服务：`backend/app/services/session_service.py`
- 仓库：`backend/app/repositories/session_repository.py`
- 迁移：`backend/migrations/versions/add_character_id_to_session.py`

### 前端
- 新建会话面板：`frontend/src/components/CreateSessionChatPanel.vue`
- 角色页面：`frontend/src/components/CharactersPage.vue`

## API 调用示例

### 完全继承
```bash
curl -X POST http://localhost:8000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"character_id": "char_xxx"}'
```

### 部分覆盖
```bash
curl -X POST http://localhost:8000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "character_id": "char_xxx",
    "model_id": "model_yyy",
    "settings": {
      "model_temperature": 0.9
    }
  }'
```

## 继承规则

| 字段 | 继承策略 | 可覆盖 |
|------|---------|--------|
| title | ✓ 继承 | ✓ 是 |
| avatar_url | ✓ 继承 | ✓ 是 |
| description | ✓ 继承 | ✓ 是 |
| model_id | ✓ 继承 | ✓ 是 |
| settings | ✓ 深度合并 | ✓ 是 |

## Settings 合并逻辑

```python
# 基础逻辑
final_settings = character.settings.copy()  # 以角色设置为基础
if user_provided_settings:
    final_settings.update(user_provided_settings)  # 只覆盖提供的字段
```

### 示例

角色设置:
```json
{
  "assistant_name": "小智",
  "assistant_identity": "AI 助手",
  "system_prompt": "你是一个有帮助的 AI 助手",
  "memory_type": "sliding_window",
  "max_memory_length": 10,
  "model_temperature": 0.7,
  "model_top_p": 0.9
}
```

用户提供:
```json
{
  "model_temperature": 0.9,
  "web_search_enabled": true
}
```

最终结果:
```json
{
  "assistant_name": "小智",              // 保留
  "assistant_identity": "AI 助手",       // 保留
  "system_prompt": "...",               // 保留
  "memory_type": "sliding_window",      // 保留
  "max_memory_length": 10,              // 保留
  "model_temperature": 0.9,             // 覆盖
  "model_top_p": 0.9,                   // 保留
  "web_search_enabled": true            // 新增
}
```

## 部署步骤

1. **应用数据库迁移**
   ```bash
   cd backend
   alembic upgrade head
   ```

2. **验证迁移**
   ```sql
   -- 检查 character_id 列是否添加成功
   DESCRIBE session;
   ```

3. **测试功能**
   ```bash
   python test_session_character_inheritance.py
   ```

4. **重启后端服务**

5. **更新前端代码并重新构建**

## 常见问题

### Q: 现有会话会受影响吗？
A: 不会。现有会话的 `character_id` 为 NULL，正常使用。

### Q: 如果角色被删除，会话会怎样？
A: 会话的 `character_id` 会被设为 NULL (ON DELETE SET NULL)，会话本身不会被删除。

### Q: 可以不绑定角色创建会话吗？
A: 不可以。新 API 要求必须提供 `character_id`，否则返回 400 错误。

### Q: 如何修改已经创建的会话的配置？
A: 使用 PUT /api/v1/sessions/{id} 接口，只提供需要更新的字段。

## 调试技巧

### 检查会话是否正确继承
```python
# 在 Python 中
session = await api.fetch_session(session_id)
print(f"Character ID: {session.character_id}")
print(f"Settings: {session.settings}")
```

### 检查数据库关联
```sql
SELECT 
    s.id,
    s.title,
    s.character_id,
    c.title as character_title,
    s.settings
FROM session s
LEFT JOIN character c ON s.character_id = c.id
WHERE s.id = 'your_session_id';
```

## 下一步行动

- [ ] 运行数据库迁移
- [ ] 执行测试脚本验证功能
- [ ] 更新前端代码
- [ ] 在测试环境验证完整流程
- [ ] 部署到生产环境
- [ ] 监控日志确保无异常
