# 设置模块重构 - 快速参考

## 🗺️ 路由映射

### 账户中心 (AccountCenter)

| 路径 | 组件 | 说明 |
|------|------|------|
| `/account-center` | AccountCenter.vue | 自动跳转到默认标签页 |
| `/account-center/profile` | UserProfile.vue | 账户概览 |
| `/account-center/subaccounts` | UserSubaccounts.vue | 子账户管理（仅主账户） |
| `/account-center/security` | UserSecurity.vue | 安全设置 |

### 系统设置 (SystemSettings)

| 路径 | 组件 | 说明 |
|------|------|------|
| `/system-settings` | SystemSettings.vue | 自动跳转到默认标签页 |
| `/system-settings/models` | ModelsSettings.vue | 模型管理（仅主账户） |
| `/system-settings/default-models` | DefaultModelSettings.vue | 默认模型（仅主账户） |
| `/system-settings/mcp` | MCPServers.vue | MCP 服务器（仅主账户） |

## 🔗 侧边栏入口

```
MainSidebar.vue
├── 对话 (Chat)
├── 助手 (Characters)
├── 账户 (AccountCenter) ← 新增
├── 设置 (SystemSettings) ← 修改
└── 知识 (KnowledgeBase)
```

## 💡 使用示例

### 编程式导航

```typescript
import { useRouter } from 'vue-router'

const router = useRouter()

// 跳转到账户中心（默认标签页）
router.push({ name: 'AccountCenter' })

// 跳转到特定标签页
router.push({ name: 'AccountCenter', params: { tab: 'security' } })

// 跳转到系统设置
router.push({ name: 'SystemSettings', params: { tab: 'models' } })
```

### 声明式导航

```vue
<template>
    <!-- 账户中心 -->
    <router-link :to="{ name: 'AccountCenter' }">
        账户中心
    </router-link>
    
    <!-- 特定标签页 -->
    <router-link :to="{ name: 'AccountCenter', params: { tab: 'profile' } }">
        账户概览
    </router-link>
    
    <!-- 系统设置 -->
    <router-link :to="{ name: 'SystemSettings', params: { tab: 'mcp' } }">
        MCP 服务器
    </router-link>
</template>
```

## 🎯 关键特性

### 1. 默认标签页

进入模块时自动选中第一个可用标签页：

```typescript
// AccountCenter: profile (或 subaccounts/security，取决于角色)
// SystemSettings: models (或 default-models/mcp)
```

### 2. URL 同步

切换标签页时自动更新 URL：

```
点击"安全设置" → URL 变为 /account-center/security
刷新页面 → 仍显示安全设置 ✅
```

### 3. 角色权限

根据用户角色动态过滤菜单：

```typescript
// 主账户 (primary)
- 账户概览 ✅
- 子账户 ✅
- 安全设置 ✅

// 子账户 (subaccount)
- 账户概览 ✅
- 子账户 ❌ (隐藏)
- 安全设置 ✅
```

### 4. 移动端适配

```
桌面端 (> 768px): 侧边栏始终显示
移动端 (< 768px): 点击菜单项后自动收起侧边栏
```

## 🔍 调试技巧

### 查看当前路由

```typescript
import { useRoute } from 'vue-router'

const route = useRoute()
console.log('当前路由:', route.name)
console.log('当前标签:', route.params.tab)
```

### 监听路由变化

```typescript
watch(() => route.params.tab, (newTab) => {
    console.log('标签页切换:', newTab)
})
```

### 检查用户角色

```typescript
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
console.log('用户角色:', authStore.user?.role)
```

## ⚠️ 常见问题

### Q1: 为什么刷新后回到了默认标签页？

**A:** 确保 URL 中包含标签参数：
```
✅ 正确: /account-center/security
❌ 错误: /account-center
```

### Q2: 子账户看不到"子账户"标签页？

**A:** 这是预期行为。子账户只能访问：
- 账户概览
- 安全设置

### Q3: 如何添加新的标签页？

**A:** 以账户中心为例：

1. 创建新组件 `src/components/settings/NewFeature.vue`
2. 在 `AccountCenter.vue` 中导入并注册
3. 在 `sidebarItems` 数组中添加配置：
   ```typescript
   {
       label: '新功能',
       path: 'new-feature',
       icon: NewIcon,
       roles: ['primary', 'subaccount']
   }
   ```
4. 在模板中添加条件渲染：
   ```vue
   <template v-else-if="currentTabValue === 'new-feature'">
       <NewFeature />
   </template>
   ```

### Q4: 旧的 /settings 链接还能用吗？

**A:** 不能。需要更新为新的路径：
```
旧: /settings/profile
新: /account-center/profile

旧: /settings/models
新: /system-settings/models
```

如需兼容旧链接，可在 `main.js` 中添加重定向规则。

## 📖 相关文档

- [详细重构报告](./SETTINGS_MODULE_REFACTORING.md)
- [Vue Router 官方文档](https://router.vuejs.org/)
- [VueUse Breakpoints](https://vueuse.org/core/useBreakpoints/)

## 🚀 快速测试

```bash
# 1. 启动开发服务器
npm run dev

# 2. 测试账户中心
浏览器访问: http://localhost:5173/account-center
预期: 自动跳转到 /account-center/profile

# 3. 测试系统设置
浏览器访问: http://localhost:5173/system-settings
预期: 自动跳转到 /system-settings/models

# 4. 测试标签切换
在账户中心内点击不同标签
预期: URL 同步更新，内容正确切换

# 5. 测试刷新保持
访问 /account-center/security 后刷新
预期: 仍显示安全设置标签页
```
