# 角色工具配置功能实现

## 功能概述

为角色设置面板新增两个工具选项卡:**本地工具**和**MCP 服务**,允许用户为每个角色自定义可用的工具集。

## 核心概念

### MCP 服务控制 vs 工具控制

**重要区别**:
- ✅ **控制对象**: MCP 服务器 (而非单个工具)
- ✅ **控制范围**: 仅针对当前角色 (不影响全局或其他角色)
- ✅ **控制方式**: 启用/禁用整个 MCP 服务

**示例场景**:
```
系统有 3 个 MCP 服务：
- Weather API (天气查询)
- Search Engine (搜索引擎)  
- Calculator (计算器)

角色 A (天气助手):
- 启用：Weather API
- 禁用：Search Engine, Calculator
- 效果：该角色只能使用天气查询功能

角色 B (全能助手):
- 启用：全部 3 个服务
- 效果：可以使用所有 MCP 功能

全局状态:
- 所有 MCP 服务仍然正常运行
- 其他角色不受影响
```

## 主要变更

### 1. 前端 - CharacterSettingPanel.vue

#### 新增 Tab 选项卡

**Tab 结构**:
```
基础 → 提示词 → 模型 → 记忆 → [本地工具] → [MCP 工具]
                          ↑ 新增        ↑ 新增
```

#### 本地工具选项卡

**功能说明**:
- 显示所有可用的本地内置工具
- 当前只有一个工具:"获取当前时间"
- 使用复选框控制启用/禁用

**UI 布局**:
```vue
<el-tab-pane name="local_tools" label="本地工具">
    <el-checkbox-group v-model="characterForm.enabled_tools">
        <div class="tool-item">
            <el-checkbox value="get_current_time">
                获取当前时间
                <el-tag type="info" size="small">内置</el-tag>
            </el-checkbox>
        </div>
    </el-checkbox-group>
</el-tab-pane>
```

**数据结构**:
```javascript
enabled_tools: ["get_current_time"]  // 启用的工具 ID 列表
```

#### MCP 服务选项卡

**功能说明**:
- 显示所有已配置的 MCP 服务器
- 使用开关控制每个 MCP 服务的启用状态
- 仅控制角色级别的访问权限，不影响全局 MCP 服务

**UI 布局**:
```vue
<el-tab-pane name="mcp_tools" label="MCP 服务">
    <el-alert title="MCP 服务说明">
        启用表示此角色可以使用该 MCP 服务，禁用不会影响其他角色或全局 MCP 服务
    </el-alert>
    
    <div v-for="server in mcpServers" :key="server.id">
        <div class="mcp-server-item">
            <div class="server-info">
                {{ server.name }} [运行中/未运行]
                {{ server.url }}
                {{ server.description }}
                可用工具：X 个
            </div>
            
            <!-- 启用/禁用开关 -->
            <el-switch
                v-model="characterForm.enabled_mcp_servers[server.id]"
                active-text="启用"
                inactive-text="禁用"
            />
        </div>
    </div>
</el-tab-pane>
```

**数据结构**:
```javascript
enabled_mcp_servers: [
    "server_id_1",  // 启用此服务
    "server_id_3"   // 启用此服务
    // server_id_2 不在数组中，表示禁用
]  // 启用的 MCP 服务器 ID 数组 (存在=启用，不存在=禁用)
```

### 2. 数据流

#### 表单数据结构

```javascript
const characterForm = reactive({
    // ... 其他字段
    enabled_tools: [],      // 本地工具
    enabled_mcp_tools: []   // MCP 工具
})
```

#### Settings 保存格式

```javascript
settings: {
    // ... 其他设置
    tools: ["get_current_time"],           // 本地工具列表
    mcp_servers: ["server1_tool1"]         // MCP 工具列表
}
```

**注意**: 
- `tools` 字段存储本地工具 ID 数组
- `mcp_servers` 字段存储已启用的 MCP 服务器 ID 数组 (存在即启用)

### 3. API 集成

#### 新增方法 - ApiService.js

```javascript
/**
 * 获取所有 MCP 服务器列表
 * @returns {Promise<Object>} 返回 MCP 服务器列表数据
 */
async getMcpServers() {
    return await this._request('/mcp-servers');
}
```

#### 加载逻辑

```javascript
// 组件挂载时加载 MCP 服务器列表
onMounted(async () => {
    loadModels();      // 加载模型列表
    loadMCPServers();  // 加载 MCP 服务器列表
})

const loadMCPServers = async () => {
    try {
        const response = await apiService.getMcpServers()
        // 只显示已启动的服务器
        mcpServers.value = response.items.filter(server => server.enabled)
    } catch (error) {
        console.error('获取 MCP 服务器列表失败:', error)
    }
}
```

### 4. 样式设计

#### 工具项样式

```css
.tool-item {
    transition: all 0.2s;
}

.tool-item:hover {
    border-color: var(--el-color-primary);
    background-color: #f5f7fa;
}
```

#### MCP 服务器卡片

```css
.mcp-server-item {
    transition: all 0.2s;
}

.mcp-server-item:hover {
    border-color: var(--el-color-primary-light-5);
}
```

#### 工具网格布局

```css
.tool-checkbox-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
}

.tool-checkbox-item.is-checked .tool-name {
    background-color: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    border: 1px solid var(--el-color-primary);
}
```

## 后端兼容性

### Schema 支持

后端 `Character` schema 已经支持任意字典格式的 settings:

```python
class CharacterBase(BaseModel):
    # ... 其他字段
    settings: Optional[dict] = None
```

**无需修改后端代码**,因为:
- `tools` 和 `mcp_servers` 都存储在已有的 `settings` 字段中
- settings 是灵活的 dict 类型，可以容纳任何新字段
- 不需要数据库迁移

### 数据存储格式

```json
{
    "id": "char_123",
    "title": "助手角色",
    "settings": {
        "assistant_name": "小助手",
        "model_temperature": 0.7,
        "tools": ["get_current_time"],
        "mcp_servers": ["weather_api", "search_tool"]
    }
}
```

## 使用场景

### 场景 1: 启用本地时间工具

1. 打开角色编辑
2. 切换到"本地工具"标签
3. 勾选"获取当前时间"
4. 点击"应用全部设置"

**效果**: 该角色在对话中可以调用当前时间信息

### 场景 2: 配置 MCP 服务

某个角色只需要特定的 MCP 功能:

1. 打开角色编辑
2. 切换到"MCP 服务"标签
3. 启用需要的 MCP 服务，禁用不需要的
4. 保存设置

**示例**:
- 天气查询角色：只启用 weather_api 服务
- 搜索助手角色：只启用 search_engine 服务
- 数据分析角色：启用 calculator 和 data_analysis 服务

**效果**:
- ✅ 该角色只能访问启用的 MCP 服务
- ✅ 不影响其他角色使用所有服务
- ✅ 不影响 MCP 服务的全局运行状态

### 场景 3: 临时禁用服务

某个 MCP 服务暂时不需要某个角色使用:

1. 找到对应的 MCP 服务卡片
2. 点击开关切换到"禁用"状态
3. 保存设置

**注意**: 
- ✅ 只是角色级别禁用
- ✅ 不影响其他角色使用该服务
- ✅ 不影响 MCP 服务的全局状态
- ✅ 随时可以重新启用

## 技术特点

### 优点

1. **灵活的工具管理**
   - 每个角色独立的工具集
   - 细粒度的工具级别控制

2. **清晰的职责分离**
   - 本地工具：内置功能
   - MCP 工具：外部服务

3. **无侵入式设计**
   - 不需要修改数据库 schema
   - 利用现有的 settings 字段
   - 向后兼容旧角色

4. **用户友好**
   - 直观的复选框界面
   - 清晰的视觉反馈
   - 响应式布局

### 性能优化

1. **按需加载**
   - 只加载已启动的 MCP 服务器
   - 避免不必要的网络请求

2. **高效渲染**
   - Grid 布局自动适配屏幕宽度
   - CSS 过渡动画提升体验

## 扩展性

### 未来可添加的本地工具

```javascript
const localTools = [
    { id: 'get_current_time', name: '获取当前时间', description: '...' },
    { id: 'calculate', name: '计算器', description: '...' },
    { id: 'random_number', name: '随机数生成', description: '...' },
    { id: 'text_translate', name: '文本翻译', description: '...' }
];
```

### MCP 工具增强

1. **工具分组**: 按功能分类显示
2. **工具详情**: 点击显示工具描述和参数
3. **批量操作**: 一键启用/禁用所有工具
4. **工具测试**: 在设置面板直接测试工具

## 注意事项

### 数据格式约定

**MCP 服务 ID 格式**:
```
格式：UUID 或 ULID
示例："01HQKZJ8V5T6N7X8Y9Z0A1B2C3"
存储：["01HQKZJ8...", "02ABCDEF..."]
判断：includes(serverId) 检查是否启用
```

**本地工具 ID 格式**:
```
格式：snake_case 命名
示例：get_current_time, calculate
```

### 验证规则

当前没有添加工具数量的限制，后续可以根据需要添加:

```javascript
const toolRules = {
    enabled_tools: [
        { max: 10, message: '最多启用 10 个本地工具' }
    ],
    enabled_mcp_tools: [
        { max: 20, message: '最多启用 20 个 MCP 工具' }
    ]
}
```

## 测试建议

### 功能测试清单

- [ ] **本地工具 Tab**
  - [ ] 正确显示所有本地工具
  - [ ] 复选框状态与 settings.tools 同步
  - [ ] 保存后数据正确提交

- [ ] **MCP 工具 Tab**
  - [ ] 正确显示已启动的 MCP 服务器
  - [ ] 每个服务器的工具列表正确显示
  - [ ] 复选框状态与 settings.mcp_servers 同步
  - [ ] 保存后数据正确提交

- [ ] **数据加载**
  - [ ] onMounted 时正确调用 loadMCPServers
  - [ ] 无 MCP 服务器时显示空状态提示
  - [ ] 加载失败时有错误处理

- [ ] **样式交互**
  - [ ] hover 效果正常
  - [ ] 选中状态样式正确
  - [ ] 响应式布局适配不同屏幕

### 集成测试

1. **创建角色时配置工具**
   ```
   新建角色 → 配置工具 → 保存 → 验证 settings 字段
   ```

2. **编辑已有角色**
   ```
   打开角色 → 修改工具配置 → 保存 → 验证更新
   ```

3. **工具实际使用**
   ```
   配置工具 → 开始对话 → 发送相关消息 → 验证工具调用
   ```

## 相关文档

- [MCP 服务器管理文档](./MCP_SERVER_API.md)
- [角色编辑面板文档](./CHARACTER_SETTING_PANEL.md)
- [会话继承架构文档](./SESSION_CHARACTER_INHERITANCE.md)

---

**更新日期**: 2026-03-23  
**状态**: ✅ 完成  
**影响范围**: 前端 - CharacterSettingPanel 组件、ApiService  
**向后兼容**: ✅ 完全兼容 - 利用现有 settings 字段  
**数据库变更**: ❌ 无需修改 - 使用 JSON 字段存储
