# 角色头像默认显示功能

## 功能概述

当角色未设置自定义头像时，系统会自动使用角色名称（title）的第一个字符作为占位符头像显示。

## 实现细节

### 前端实现

#### 1. Avatar 组件增强 (`frontend/src/components/ui/Avatar.vue`)

- 新增 `name` 属性，用于接收角色名称
- 当 `src` 为空且 `type` 为 `assistant` 时，显示名称的第一个字符
- 首字样式：白色文字、加粗、带阴影效果，确保在各种背景下清晰可见

```vue
<Avatar 
  :src="character.avatarUrl" 
  :name="character.title" 
  type="assistant" 
/>
```

#### 2. AvatarPreview 组件支持 (`frontend/src/components/ui/AvatarPreview.vue`)

- 透传 `name` 属性给内部的 Avatar 组件
- 保持与现有裁剪和上传功能的兼容性

#### 3. 应用位置

已在以下组件中应用首字头像功能：

- `CharacterSettingPanel.vue` - 角色设置面板
- `CharactersPage.vue` - 角色列表页面
- `CreateSessionChatPanel.vue` - 创建会话时的角色选择器
- `ChatPanel.vue` - 聊天面板欢迎页
- `ChatPanel/WelcomeScreen.vue` - 欢迎屏幕
- `ChatSidebar.vue` - 聊天侧边栏会话列表
- `MessageItem.vue` - 消息项（使用模型名称）
- `MainSidebar.vue` - 主侧边栏用户头像（使用昵称）
- `account/UserSubaccounts.vue` - 子账号列表（使用昵称）

### 后端实现

后端无需修改，因为：

1. 数据库 schema 中 `avatarUrl` 字段已定义为可选类型 (`String?`)
2. Prisma schema: `avatarUrl String? @map("avatar_url")`
3. Service 层直接传递数据，不做特殊处理
4. 当前端发送 `avatarUrl: null` 或空字符串时，后端会正确存储为 `null`

### 工作流程

1. **创建新角色**：
   - 用户未上传头像 → `avatarUrl` 为 `null` 或空字符串
   - 前端 Avatar 组件检测到无图片且提供了 `name`
   - 自动显示角色名称的首字符

2. **编辑现有角色**：
   - 用户可以上传自定义头像
   - 也可以删除/清空头像（如果实现了此功能）
   - 清空后自动恢复为首字显示

3. **显示逻辑优先级**：
   ```
   有 avatarUrl → 显示图片
   无 avatarUrl 且有 name → 显示首字符
   无 avatarUrl 且无 name → 显示默认图标
   ```

## 样式规范

首字头像样式：
- 字体大小：2em（相对于容器）
- 字重：600（半粗体）
- **亮色模式**：深灰色文字 (#333)，浅灰背景 (#f5f5f5)
- **暗色模式**：浅灰色文字 (#e5e7eb)，深灰背景 (#374151)
- **扁平化设计**：无阴影、无立体效果
- 高对比度：确保在各种背景下清晰可读

## 注意事项

1. **必须设置 type 属性**：所有显示角色头像的地方必须添加 `type="assistant"`，否则首字不会显示
2. **用户头像**：类型为 `user` 的头像仍显示 UserOutlined 图标，不使用首字
3. **中英文兼容**：支持中文、英文及其他语言的首字符提取
4. **空格处理**：自动去除名称前后空格后再提取首字符
5. **空名称处理**：如果名称为空，回退到默认图标显示
6. **暗色模式**：自动适配系统或用户设置的暗色模式

## 测试建议

1. 创建新角色且不上传头像，验证首字显示
2. 上传自定义头像，验证图片显示
3. 修改角色名称，验证首字同步更新
4. 测试中英文名称的首字显示效果
5. 测试名称包含空格的情况
6. **切换暗色模式**，验证颜色自动适配
7. **检查所有角色列表和会话列表**，确认首字正常显示
8. **验证对比度**：确保文字在背景下清晰可读
