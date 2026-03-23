# Session Avatar 移除与继承逻辑更新

## 更新概述

根据新的架构设计，会话 (Session) 不再拥有独立的头像，而是继承自绑定的角色 (Character)。同时简化了会话设置的继承和更新逻辑。

## 核心变更

### 1. 会话继承逻辑

#### 创建会话时的继承规则

**之前**:
- 会话可以继承角色的所有配置
- 允许用户覆盖 title、avatar_url、description、model_id、settings

**现在**:
- 会话**固定继承**角色的以下字段（不允许覆盖）:
  - `title` - 会话标题
  - `avatar_url` - 会话头像  
  - `description` - 会话描述
- 会话**允许覆盖**的配置:
  - `model_id` - 使用的模型
  - `settings.max_memory_length` - 上下文条数

#### 代码实现

**后端 - session_service.py**:
```python
async def create_session(self, user: User, data: dict):
    # 获取角色信息
    character = await self.character_repo.get_character_by_id(character_id)
    
    # 继承角色配置，只允许覆盖 model_id和 settings.max_memory_length
    session_data = {
        "user_id": user.id,
        "character_id": character_id,
        "title": character.title,  # 不再允许覆盖
        "avatar_url": character.avatar_url,  # 不再允许覆盖
        "description": character.description,  # 不再允许覆盖
        "model_id": data.get("model_id", character.model_id),  # 允许覆盖
    }
    
    # 合并 settings：只从角色继承 max_memory_length，然后合并用户传入的设置（用户设置优先）
    session_data["settings"] = {}
    
    # 1. 从角色继承 max_memory_length
    if character.settings and "max_memory_length" in character.settings:
        session_data["settings"]["max_memory_length"] = character.settings["max_memory_length"]
    
    # 2. 合并用户传入的设置（会覆盖继承的值）
    if data.get("settings"):
        session_data["settings"].update(data["settings"])
```

### 2. 删除 avatar_url 字段

#### Schema 变更

**app/schemas/session.py**:

**SessionBase**:
```python
class SessionBase(BaseModel):
    title: Optional[str] = None
    user_id: Optional[str] = None
    # ❌ 删除 avatar_url
    description: Optional[str] = None
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None
```

**SessionCreate**:
```python
class SessionCreate(BaseModel):
    character_id: str  # 必填
    model_id: Optional[str] = None  # 允许覆盖
    settings: Optional[SessionSettings] = None  # 只允许 max_memory_length
    # ❌ 删除 title, avatar_url, description
```

**SessionUpdate**:
```python
class SessionUpdate(BaseModel):
    model_id: Optional[str] = None
    settings: Optional[SessionSettings] = None
    # ❌ 删除 title, avatar_url, description
```

**SessionItemOut**:
```python
class SessionItemOut(BaseResponse):
    id: str
    title: Optional[str] = None
    user_id: Optional[str] = None
    # ❌ 删除 avatar_url
    description: Optional[str] = None
    model_id: Optional[str] = None
    character_id: Optional[str] = None
    settings: Optional[SessionSettings] = None
    character: Optional["CharacterOut"] = None  # ✅ 添加角色信息（用于获取 avatar）
```

### 3. 前端显示逻辑

#### ChatSidebar.vue

**之前**:
```vue
<Avatar :src="session.avatar_url" round />
```

**现在**:
```vue
<!-- 优先使用角色的 avatar，如果没有则使用会话的 avatar -->
<Avatar :src="session.character?.avatar_url || session.avatar_url" round />
```

### 4. 更新会话设置

#### 后端 - session_service.py

**之前**:
```python
async def update_session(self, session_id, user: User, data: dict):
    session.update(data)  # 允许更新所有字段
    
    # 处理 avatar 文件删除
    if "avatar_url" in data and data["avatar_url"] != old_avatar_url:
        old_avatar_path = convert_webpath_to_filepath(old_avatar_url)
        remove_file(old_avatar_path)
```

**现在**:
```python
async def update_session(self, session_id, user: User, data: dict):
    # 只允许更新 model_id 和 settings.max_memory_length
    allowed_fields = ["model_id", "settings"]
    filtered_data = {k: v for k, v in data.items() if k in allowed_fields}
    
    # 如果更新了 settings，只保留 max_memory_length
    if "settings" in filtered_data:
        filtered_data["settings"] = {
            "max_memory_length": filtered_data["settings"].get("max_memory_length")
        }
    
    session.update(filtered_data)
```

#### 前端 - ChatPage.vue

**之前**:
```javascript
const updateSession = async (data) => {
  // ...
  if (session && data.avatar_file) {
    const response = await apiService.uploadAvatar(currentSession.value.id, data.avatar_file, 'session');
    session.avatar_url = response.url;
  }
  // ...
};
```

**现在**:
```javascript
const updateSession = async (data) => {
  // ...
  // 合并设置
  data.settings = { ...currentSession.value.settings, ...data.settings };
  await apiService.updateSession(currentSession.value.id, data);
  session = { id: currentSession.value.id, ...data, updated_at: new Date().toISOString() };
  currentSession.value = session;
  // ...
};
```

### 5. 删除 API 端点

#### routes/sessions.py

**删除的路由**:
```python
# ❌ 已删除
@sessions_router.post("/sessions/{session_id}/avatars")
async def upload_session_avatar(...):
    # 上传会话头像的接口
```

### 6. 删除 Service 方法

#### session_service.py

**删除的方法**:
```python
# ❌ 已删除
async def upload_avatar(self, session_id, user: User, avatar_file):
    # 上传会话头像的方法
```

## 数据流对比

### 创建会话流程

#### 之前
```
用户请求 → SessionCreate(title?, avatar_url?, description?, model_id?, settings?)
         ↓
SessionService.create_session()
         ↓
继承角色配置 + 用户覆盖
         ↓
创建 Session(可自定义 title/avatar/description)
```

#### 现在
```
用户请求 → SessionCreate(model_id?, settings?{max_memory_length})
         ↓
SessionService.create_session()
         ↓
完全继承角色配置 + 仅允许 model_id/settings
         ↓
创建 Session(固定使用角色的 title/avatar/description)
```

### 获取会话列表

#### 之前
```
GET /api/v1/sessions
      ↓
返回 SessionItemOut[] (包含 avatar_url)
      ↓
前端直接显示 session.avatar_url
```

#### 现在
```
GET /api/v1/sessions
      ↓
返回 SessionItemOut[] (包含 character 对象)
      ↓
前端显示 session.character.avatar_url || session.avatar_url
```

## 修改的文件清单

### 后端文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/services/session_service.py` | ✏️ 修改 | create_session、update_session 逻辑；删除 upload_avatar |
| `app/schemas/session.py` | ✏️ 修改 | 删除 avatar_url 字段；添加 character 到 SessionItemOut |
| `app/routes/sessions.py` | ✏️ 修改 | 删除 upload_session_avatar 路由 |

### 前端文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/components/ChatSidebar.vue` | ✏️ 修改 | 优先使用 character.avatar_url |
| `src/components/ChatPage.vue` | ✏️ 修改 | 删除 avatar 上传逻辑 |
| `src/components/SessionSettingPanel.vue` | ✏️ 修改 | props 默认值调整 |

## 设计理念

### 为什么这样设计？

1. **简化用户体验**
   - 用户不需要为每个会话单独设置头像
   - 会话自动继承角色形象，保持一致性

2. **清晰的职责分离**
   - **角色编辑**: 完整的自定义配置（包括头像、标题、描述等）
   - **会话设置**: 仅运行时参数调整（模型、上下文长度）

3. **数据一致性**
   - 同一角色的所有会话使用相同的头像
   - 避免混淆（之前可能出现同一角色不同头像的情况）

4. **减少存储冗余**
   - 不再需要为每个会话存储 avatar_url
   - 数据库更简洁

### 适用场景

#### ✅ 适合的场景

1. **基于角色的对话**
   - 每个会话都是与特定角色的交流
   - 角色形象应该保持一致

2. **快速创建会话**
   - 无需每次创建都设置头像
   - 一键创建，立即开始对话

3. **多会话管理**
   - 同一角色可以有多个会话
   - 通过标题区分不同话题

#### ❌ 不适合的场景

如果需要:
- 为会话设置独特的头像
- 完全自定义会话的标题和描述

**解决方案**: 在角色编辑中创建新角色，然后基于该角色创建会话

## 迁移指南

### 现有数据处理

如果数据库中已有带 `avatar_url` 的会话:

```sql
-- 可选：更新现有会话，使用角色的 avatar_url
UPDATE sessions s
SET avatar_url = (
    SELECT avatar_url FROM characters c WHERE c.id = s.character_id
)
WHERE s.character_id IS NOT NULL;
```

### 前端代码适配

**检查点**:
```javascript
// ❌ 旧的访问方式（会返回 undefined）
session.avatar_url

// ✅ 新的访问方式
session.character?.avatar_url || session.avatar_url
```

### API 调用适配

**创建会话**:
```javascript
// ✅ 新的调用方式
await apiService.createSession({
    character_id: "char_123",
    model_id: "gpt-4",  // 可选
    settings: {
        max_memory_length: 20  // 唯一允许的设置
    }
});
```

**更新会话**:
```javascript
// ✅ 只能更新 model_id 和 settings
await apiService.updateSession(sessionId, {
    model_id: "new_model",
    settings: {
        max_memory_length: 30
    }
});
```

## 测试建议

### 后端测试

- [ ] **创建会话**
  - [ ] 验证 title/avatar/description 是否继承自角色
  - [ ] 验证 model_id 是否可以覆盖
  - [ ] 验证 settings 是否只保留 max_memory_length

- [ ] **更新会话**
  - [ ] 验证只能更新 model_id和 settings
  - [ ] 验证其他字段无法更新

- [ ] **获取会话**
  - [ ] 验证返回数据包含 character 对象
  - [ ] 验证 avatar_url 字段不存在

### 前端测试

- [ ] **会话列表显示**
  - [ ] 验证头像是否正确显示（使用 character.avatar_url）
  - [ ] 验证没有 avatar_url 时会话仍然正常显示

- [ ] **会话设置**
  - [ ] 验证只能修改模型和上下文条数
  - [ ] 验证保存后数据正确提交

- [ ] **创建会话**
  - [ ] 验证新会话使用角色的头像

## 性能影响

### 积极影响

1. **减少数据传输**
   - SessionItemOut 减少 avatar_url 字段
   - 响应体积略减小

2. **减少存储**
   - 数据库不再需要为每个会话存储 avatar_url
   - 特别是对于大量会话的场景

### 潜在影响

1. **查询复杂度**
   - SessionItemOut 包含 character 对象
   - 可能需要额外的 JOIN 查询
   
2. **前端兼容性**
   - 需要确保 session.character 存在
   - 添加 fallback 逻辑

## 相关文档

- [会话设置面板极简版文档](../frontend/SESSION_SETTING_PANEL_MINIMAL.md)
- [会话继承角色架构设计](./SESSION_CHARACTER_INHERITANCE.md)
- [角色编辑面板文档](./CHARACTER_SETTING_PANEL.md)

---

**更新日期**: 2026-03-23  
**状态**: ✅ 完成  
**影响范围**: 前后端 - Session 相关功能  
**向后兼容**: ⚠️ 破坏性变更 - avatar_url 字段已移除  
**迁移建议**: 更新前端代码以使用 character.avatar_url
