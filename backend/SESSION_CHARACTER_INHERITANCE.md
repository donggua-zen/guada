# 会话继承角色功能实现说明

## 概述

实现了会话对角色配置的**继承机制**,替代了之前的**完整复制**机制。创建会话时必须绑定一个角色，会话会继承角色的所有配置，但可以选择性地覆盖特定字段。

## 核心变更

### 1. 数据库模型变更

#### Session 模型 (app/models/session.py)
- **新增字段**: `character_id` - 外键关联到 Character 表
- **新增关系**: `character` - 与 Character 的多对一关系
- 删除策略：`ondelete="SET NULL"` - 角色被删除时，会话的 character_id 设为 NULL

```python
character_id = Column(
    String(26),
    ForeignKey("character.id", ondelete="SET NULL"),
    index=True,
    nullable=True,
)

character: Mapped[Optional["Character"]] = relationship(
    "Character",
    passive_deletes=True,
    uselist=False,
)
```

### 2. Schema 变更

#### SessionCreate (app/schemas/session.py)
- **character_id 改为必填字段** (`str` 类型，无默认值)
- 其他字段保持可选，用于覆盖角色配置

```python
class SessionCreate(BaseModel):
    character_id: str  # 必填，绑定角色
    title: Optional[str] = None  # 可选，如果提供则覆盖角色的 title
    avatar_url: Optional[str] = None  # 可选，如果提供则覆盖角色的 avatar
    description: Optional[str] = None
    model_id: Optional[str] = None  # 可选，如果提供则覆盖角色的 model_id
    settings: Optional[SessionSettings] = None  # 可选，只保存覆盖的配置
```

#### SessionOut (app/schemas/session.py)
- **新增字段**: `character_id` - 返回关联的角色 ID
- **新增字段**: `character` - 返回完整的角色信息

```python
class SessionOut(SessionItemOut):
    model: Optional[ModelOut] = None  # 添加模型信息
    character: Optional["CharacterOut"] = None  # 添加角色信息
```

### 3. 业务逻辑变更

#### SessionService.create_session (app/services/session_service.py)

**核心变化**:
1. `character_id` 现在是**必填参数**,否则抛出 400 错误
2. 不再完整复制角色配置，而是采用**继承 + 选择性覆盖**的策略
3. Settings 采用**深度合并**策略：角色的 settings 作为基础，只覆盖提供的字段

```python
async def create_session(self, user: User, data: dict):
    character_id = data.get("character_id")
    if not character_id:
        raise HTTPException(status_code=400, detail="character_id is required")
    
    # 获取角色信息
    character = await self.character_repo.get_character_by_id(character_id)
    if not character:
        raise HTTPException(status_code=404, detail=f"Character with ID {character_id} not found")
    
    # 继承角色配置，只覆盖提供的字段
    session_data = {
        "user_id": user.id,
        "character_id": character_id,  # 绑定角色
        "title": data.get("title", character.title),
        "avatar_url": data.get("avatar_url", character.avatar_url),
        "description": data.get("description", character.description),
        "model_id": data.get("model_id", character.model_id),
    }
    
    # 合并 settings：角色的 settings 作为基础，只覆盖提供的字段
    if character.settings:
        session_data["settings"] = character.settings.copy()
        if data.get("settings"):
            session_data["settings"].update(data["settings"])
    else:
        session_data["settings"] = data.get("settings")
```

#### SessionRepository.get_session_by_id
- **优化查询**: 使用 `selectinload` 同时加载 `model` 和 `character` 关联数据

```python
async def get_session_by_id(self, session_id):
    stmt = select(Session).filter(Session.id == session_id)
    stmt = stmt.options(
        selectinload(Session.model),
        selectinload(Session.character)
    )
```

### 4. 前端组件变更

#### CreateSessionChatPanel.vue
- **新增状态**: `currentSession.character_id` - 跟踪当前选择的角色
- **强制验证**: 发送消息或创建会话前检查是否已选择角色
- **用户提示**: 未选择角色时显示提示框，引导用户前往角色页面

```javascript
const currentSession = ref({
  character_id: null,  // 必须绑定角色
  model_id: null,
  // ...
})

// 发送消息时验证
if (!currentSession.value.character_id) {
  notify.error('请先选择一个角色模板');
  router.push({ name: 'Characters' });
  return;
}

emit("create-session", {
  character_id: currentSession.value.character_id,
  model_id: currentModel.value.id,
  // ...
})
```

#### CharactersPage.vue
- **完善数据传输**: `startNewChat` 函数传递完整的角色配置数据

```javascript
const startNewChat = async (character) => {
  emit('create-session', { 
    character_id: character.id,
    title: character.title,
    avatar_url: character.avatar_url,
    description: character.description,
    model_id: character.model_id,
    settings: character.settings
  })
}
```

### 5. 数据库迁移

创建迁移文件：`migrations/versions/add_character_id_to_session.py`

```python
def upgrade() -> None:
    # 添加 character_id 列
    op.add_column('session', sa.Column('character_id', sa.String(26), nullable=True))
    
    # 创建索引
    op.create_index(op.f('ix_session_character_id'), 'session', ['character_id'], unique=False)
    
    # 添加外键约束
    op.create_foreign_key(
        'fk_session_character',
        'session',
        'character',
        local_cols=['character_id'],
        remote_cols=['id'],
        ondelete='SET NULL'
    )
```

## 使用示例

### API 调用示例

#### 1. 完全继承角色配置
```json
POST /api/v1/sessions
{
  "character_id": "char_123"
}
```

结果：
- 会话继承角色的所有配置
- `title`, `avatar_url`, `model_id`, `settings` 都与角色相同

#### 2. 覆盖部分配置
```json
POST /api/v1/sessions
{
  "character_id": "char_123",
  "title": "自定义标题",
  "model_id": "model_456",
  "settings": {
    "model_temperature": 0.9,
    "web_search_enabled": true
  }
}
```

结果:
- `title` 被覆盖为 "自定义标题"
- `model_id` 被覆盖为 "model_456"
- `settings` 中:
  - `model_temperature` 被覆盖为 0.9
  - `web_search_enabled` 新增为 true
  - 其他设置 (如 `assistant_name`, `system_prompt`) 保留角色的值

### 前端使用流程

1. 用户访问 `/characters` 页面选择角色
2. 点击角色的"使用"按钮，自动跳转到新建会话页面
3. 系统自动填充角色配置，用户可以选择覆盖某些设置
4. 发送第一条消息时创建会话

或者:
1. 直接访问 `/chat/new-session`
2. 系统提示需要先选择角色
3. 点击"去选择角色"按钮跳转到角色页面

## 优势

### 1. 数据一致性
- 会话与角色保持关联，修改角色配置后，现有会话不会受影响
- 角色被删除时，会话仍然保留 (character_id 设为 NULL)

### 2. 存储空间优化
- 不再为每个会话复制完整的角色配置
- 只存储覆盖的差异配置

### 3. 灵活性
- 用户可以基于同一个角色创建多个不同配置的会话
- 可以选择性地覆盖任何配置项

### 4. 可追溯性
- 通过 `character_id` 可以追溯会话的来源角色
- 便于后续实现角色相关的统计和分析功能

## 向后兼容性

### 现有会话处理
- 现有会话的 `character_id` 默认为 `NULL`
- 不影响现有会话的正常使用
- 可以通过数据迁移脚本为现有会话补充 `character_id`

### API 兼容性
- 旧版本 API 调用 (不提供 `character_id`) 会返回 400 错误
- 需要更新前端和客户端代码以提供 `character_id`

## 测试

### 单元测试
测试文件：`test_session_character_inheritance.py`

测试场景:
1. 完全继承角色配置
2. 部分覆盖角色配置
3. Settings 的深度合并
4. character_id 关联验证

### 运行测试
```bash
cd backend
python test_session_character_inheritance.py
```

## 注意事项

1. **数据库迁移**: 部署前必须先运行迁移脚本
   ```bash
   alembic upgrade head
   ```

2. **前端更新**: 确保前端代码同步更新，特别是:
   - `CreateSessionChatPanel.vue`
   - `CharactersPage.vue`
   - 任何调用 `createSession` API 的地方

3. **数据完整性**: 建议在测试环境先验证功能，再部署到生产环境

## 未来扩展

1. **角色配置同步**: 可以实现"同步角色配置"功能，让会话主动更新到角色的最新版本
2. **角色统计**: 基于 character_id 统计每个角色的使用情况
3. **模板市场**: 基于共享角色创建公共模板市场
4. **配置版本控制**: 记录角色配置的变更历史
