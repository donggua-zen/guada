# MCP 工具列表查看功能

## 📋 概述

在 MCP 服务器管理页面新增了**工具列表查看**功能，通过 Tab 切换可以在配置表单和工具列表之间快速切换，方便查看和管理 MCP 服务器提供的工具。

---

## ✨ 新增功能

### 1️⃣ **Tab 切换界面**

在添加/编辑 MCP 服务器的对话框中，新增了两个 Tab：

- **基本配置** - 原有的配置表单（名称、URL、Headers 等）
- **工具列表** - 查看该服务器提供的所有工具

### 2️⃣ **工具列表展示**

在工具列表 Tab 中，可以查看：

- ✅ 工具名称
- ✅ 工具描述
- ✅ 参数列表（包含类型、描述、是否必填、默认值等）
- ✅ 工具数量统计

### 3️⃣ **手动刷新工具**

提供"刷新工具"按钮，可以：

- 🔄 重新从 MCP 服务器获取最新工具列表
- 🔄 更新本地缓存的工具数据
- 🔄 显示刷新结果提示

### 4️⃣ **新增时友好提示**

在新增服务器模式下切换到工具列表 Tab 时，会显示友好提示：

```
ℹ️ 新增后才能查看工具
请先填写基本信息并保存
```

---

## 🎨 界面效果

### 编辑模式 - 基本配置 Tab

```
┌─────────────────────────────────────────┐
│  编辑 MCP 服务器                    [×] │
├─────────────────────────────────────────┤
│ [基本配置] [工具列表]                   │
├─────────────────────────────────────────┤
│ 服务器名称：[阿里云百炼_联网搜索    ]   │
│ 服务地址：[https://dashscope...     ]   │
│ 描述信息：[基于通义实验室...      ]     │
│ HTTP 请求头：[Authorization: ...    ]   │
│ 启用状态：[✓] 启用                      │
│                                         │
│              [取消]    [确定]           │
└─────────────────────────────────────────┘
```

### 编辑模式 - 工具列表 Tab

```
┌─────────────────────────────────────────┐
│  编辑 MCP 服务器                    [×] │
├─────────────────────────────────────────┤
│ [基本配置] [工具列表]                   │
├─────────────────────────────────────────┤
│ 已获取到 1 个工具        [🔄 刷新工具]  │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ bailian_web_search                  │ │
│ │ 搜索可用于查询百科知识、时事新闻... │ │
│ │ 参数：                              │ │
│ │   • query (string, 必填)            │ │
│ │     user query in the format of...  │ │
│ │   • count (integer, 默认：5)        │ │
│ │     number of search results        │ │
│ └─────────────────────────────────────┘ │
│                                         │
│              [取消]    [确定]           │
└─────────────────────────────────────────┘
```

### 新增模式 - 工具列表 Tab

```
┌─────────────────────────────────────────┐
│  添加 MCP 服务器                    [×] │
├─────────────────────────────────────────┤
│ [基本配置] [工具列表]                   │
├─────────────────────────────────────────┤
│                                         │
│           ℹ️                             │
│     新增后才能查看工具                   │
│     请先填写基本信息并保存               │
│                                         │
│              [取消]    [确定]           │
└─────────────────────────────────────────┘
```

---

## 🔧 技术实现

### 前端组件修改

**文件：** `src/components/settings/MCPServers.vue`

#### 1. 新增响应式数据

```javascript
const activeTab = ref('config')        // 当前激活的 Tab
const refreshingTools = ref(false)     // 刷新工具加载状态
const toolsList = ref([])              // 工具列表数组
```

#### 2. 新增图标导入

```javascript
import {
    InfoOutlined,  // 提示信息图标
    Refresh        // 刷新图标
} from '@vicons/material'
```

#### 3. 新增 UI 组件

```vue
<el-tabs v-model="activeTab">
    <el-tab-pane label="基本配置" name="config">
        <!-- 原有配置表单 -->
    </el-tab-pane>
    
    <el-tab-pane label="工具列表" name="tools">
        <!-- 工具列表内容 -->
    </el-tab-pane>
</el-tabs>
```

#### 4. 核心方法

**`loadTools(serverId)`** - 加载工具列表
```javascript
const loadTools = async (serverId) => {
    if (!serverId) {
        toolsList.value = []
        return
    }
    
    try {
        const response = await apiService.fetchMcpServerById(serverId)
        if (response && response.tools) {
            // 将对象转换为数组
            toolsList.value = Object.entries(response.tools).map(([name, tool]) => ({
                name,
                ...tool
            }))
        } else {
            toolsList.value = []
        }
    } catch (error) {
        console.error('加载工具列表失败:', error)
        toolsList.value = []
    }
}
```

**`handleRefreshTools()`** - 刷新工具列表
```javascript
const handleRefreshTools = async () => {
    if (!serverForm.value.id) {
        toast.warning('请先保存服务器')
        return
    }
    
    try {
        refreshingTools.value = true
        
        // 调用后端 API 刷新工具
        const response = await apiService.refreshMcpTools(serverForm.value.id)
        
        if (response && response.tools) {
            toolsList.value = Object.entries(response.tools).map(([name, tool]) => ({
                name,
                ...tool
            }))
            
            toast.success(`成功刷新 ${toolsList.value.length} 个工具`)
            
            // 同时更新列表中的服务器数据
            const serverIndex = servers.value.findIndex(s => s.id === serverForm.value.id)
            if (serverIndex !== -1) {
                servers.value[serverIndex].tools = response.tools
            }
        }
    } catch (error) {
        toast.error(error.message || '刷新工具失败')
    } finally {
        refreshingTools.value = false
    }
}
```

### API 服务扩展

**文件：** `src/services/ApiService.js`

#### 新增方法

**`fetchMcpServer(serverId)`** - 获取单个服务器详情
```javascript
async fetchMcpServer(serverId) {
    return await this._request(`/mcp-servers/${serverId}`)
}
```

**`refreshMcpTools(serverId)`** - 刷新工具列表
```javascript
async refreshMcpTools(serverId) {
    return await this._request(`/mcp-servers/${serverId}/refresh-tools`, {
        method: 'POST',
    })
}
```

---

## 📊 数据流转

### 编辑服务器流程

```
用户点击"编辑"按钮
    ↓
handleEditServer(server)
    ↓
1. 设置 isEditMode = true
2. 重置 activeTab = 'config'
3. 填充表单数据
    ↓
loadTools(server.id)
    ↓
apiService.fetchMcpServer(serverId)
    ↓
GET /api/v1/mcp-servers/{id}
    ↓
后端返回服务器详情（包含 tools 字段）
    ↓
转换工具格式：Object.entries(tools).map(...)
    ↓
显示在工具列表 Tab 中
```

### 刷新工具流程

```
用户点击"刷新工具"按钮
    ↓
handleRefreshTools()
    ↓
POST /api/v1/mcp-servers/{id}/refresh-tools
    ↓
后端调用 MCPClient.list_tools()
    ↓
使用 JSON-RPC 协议获取工具列表
    ↓
更新数据库中的 tools 字段
    ↓
返回最新的服务器数据
    ↓
前端更新 toolsList 和 servers 列表
    ↓
显示成功提示
```

---

## 🎯 使用场景

### 场景 1: 查看已配置的工具有哪些

1. 进入设置 → MCP 服务器
2. 点击某个服务器的"编辑"按钮
3. 切换到"工具列表" Tab
4. 查看所有可用的工具及其参数

### 场景 2: 验证工具是否正确获取

1. 添加新的 MCP 服务器
2. 保存后重新打开编辑
3. 切换到"工具列表" Tab
4. 确认工具列表是否完整

### 场景 3: 手动刷新工具

当 MCP 服务器更新了工具列表时：

1. 打开服务器编辑对话框
2. 切换到"工具列表" Tab
3. 点击"刷新工具"按钮
4. 等待刷新完成，查看最新工具

### 场景 4: 调试工具配置

如果工具调用失败：

1. 查看工具列表中的参数定义
2. 确认参数名称、类型、是否必填
3. 对比 LLM 调用时的参数
4. 找出配置问题

---

## 💡 功能特点

### 1. **友好的用户体验**

- ✅ Tab 切换流畅自然
- ✅ 空状态提示清晰明确
- ✅ 加载状态实时反馈
- ✅ 错误提示友好易懂

### 2. **清晰的工具展示**

- ✅ 工具名称醒目
- ✅ 描述信息截断适中
- ✅ 参数列表层次分明
- ✅ 必填/默认值标签醒目

### 3. **智能的状态管理**

- ✅ 新增模式不显示工具（避免困惑）
- ✅ 编辑模式自动加载工具
- ✅ 刷新后同步更新多个位置
- ✅ Tab 状态在切换时保持

### 4. **完善的错误处理**

- ✅ 加载失败不阻塞界面
- ✅ 空工具列表友好提示
- ✅ 刷新失败显示错误信息
- ✅ 网络异常优雅降级

---

## 🎨 样式优化

### 工具卡片样式

```css
.tool-item {
    transition: all 0.2s;
}

.tool-item:hover {
    border-color: #409eff;
    background-color: #f0f9ff;
}
```

- 悬停时高亮边框和背景
- 平滑过渡动画
- 深色模式适配

### 滚动条美化

```css
.tools-panel::-webkit-scrollbar {
    width: 6px;
}

.tools-panel::-webkit-scrollbar-thumb {
    background: #c1c1c1;
    border-radius: 3px;
}

.dark .tools-panel::-webkit-scrollbar-thumb {
    background: #4a4a4a;
}
```

- 细滚动条设计
- 圆角手柄
- 深色模式适配

---

## 🔗 后端依赖

### 需要的后端 API

1. **GET `/api/v1/mcp-servers/{id}`**
   - 获取单个 MCP 服务器详情
   - 返回包含 `tools` 字段

2. **POST `/api/v1/mcp-servers/{id}/refresh-tools`**
   - 手动刷新工具列表
   - 返回更新后的服务器数据

### 后端实现参考

后端需要实现：

```python
# app/routes/mcp_servers.py
@mcp_servers_router.get("/{server_id}")
async def get_server(server_id: str):
    return await service.get_server_by_id(server_id)

@mcp_servers_router.post("/{server_id}/refresh-tools")
async def refresh_tools(server_id: str):
    return await service.refresh_tools(server_id)
```

---

## 📝 注意事项

### 1. 工具列表为空的情况

可能原因：
- MCP 服务器不支持标准协议
- 网络问题导致获取失败
- 认证信息错误
- 服务器本身没有工具

解决方法：
- 检查服务器 URL 和 Headers
- 查看后端日志确认获取过程
- 手动配置工具 Schema

### 2. 刷新工具失败

可能原因：
- MCP 服务器不可达
- 认证失败
- 协议不兼容

解决方法：
- 检查网络连接
- 验证认证信息
- 查看错误日志

### 3. 性能考虑

- 工具列表缓存在前端，避免频繁请求
- 仅在必要时手动刷新
- 大量工具时注意渲染性能

---

## 🎉 总结

通过新增的 Tab 切换功能，用户可以：

✅ **快速查看工具** - 无需记忆工具名称和参数  
✅ **验证配置正确性** - 确认工具是否成功获取  
✅ **手动刷新更新** - 保持工具列表最新  
✅ **友好提示引导** - 新增时避免困惑  

这个功能大大提升了 MCP 服务器管理的便利性和可调试性！🚀