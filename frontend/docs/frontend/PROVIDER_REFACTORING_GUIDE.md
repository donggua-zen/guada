# 供应商管理功能重构 - 使用指南

## 快速开始

### 1. 数据迁移（重要）

如果数据库中已有供应商数据，需要先运行迁移脚本修复 `provider` 字段：

```bash
cd backend-ts
npx ts-node scripts/migrate-provider-field.ts
```

**迁移脚本会：**
- ✅ 将空的 `provider` 字段根据名称自动填充
- ✅ 将中文名称转换为标准标识符（如 "硅基流动" → "siliconflow"）
- ✅ 未知类型标记为 "custom"
- ✅ 已正确的记录保持不变

### 2. 验证迁移结果

```bash
cd backend-ts
npx ts-node test-provider-field.ts
```

**测试脚本会检查：**
- 📋 所有供应商的 provider 字段状态
- 📊 供应商标识符分布统计
- 🔍 模板供应商是否已添加
- ⚠️ 是否有需要修复的记录

### 3. 启动应用

```bash
# 后端
cd backend-ts
npm run start:dev

# 前端
cd frontend
npm run dev
```

---

## 功能说明

### 已添加供应商卡片交互

**悬停时显示两个按钮：**
- **模型管理**（主按钮）：进入该供应商的模型列表页面
- **供应商设置**（次要按钮）：打开编辑弹窗修改供应商配置

**特点：**
- 卡片整体不再响应点击，避免误操作
- 按钮仅在鼠标悬停时显示，界面更简洁
- 渐变遮罩提升视觉效果

### 供应商模板过滤

**智能过滤逻辑：**
- 基于 `provider` 字段精确匹配
- 已添加的模板不会在"可添加的供应商"列表中重复显示
- 删除供应商后，对应模板会自动重新出现

**示例：**
```
已添加：
  - 硅基流动 (provider: "siliconflow")
  - 我的API (provider: "custom")

可添加列表：
  ✅ OpenAI (id: "openai")
  ✅ DeepSeek (id: "deepseek")
  ❌ 硅基流动 (id: "siliconflow") ← 已添加，隐藏
```

### 供应商标签显示

卡片上会显示供应商类型的中文标签：
- `siliconflow` → "硅基流动"
- `openai` → "OpenAI"
- `deepseek` → "DeepSeek"
- `anthropic` → "Anthropic"
- `custom` → "自定义"
- 其他 → 显示 protocol 或 "未知类型"

---

## 添加供应商

### 方式一：从模板添加

1. 在"可添加的供应商"区域找到想要的模板
2. 点击"添加此供应商"按钮
3. 确认对话框中点击确定
4. 系统自动填充默认 API 地址

**特点：**
- `provider` 字段自动设置为模板 id
- 无需手动输入 API 地址
- 快捷方便

### 方式二：自定义添加

1. 点击顶部"添加自定义"按钮
2. 填写表单：
   - 名字：自定义名称
   - API地址：完整的 API 端点 URL
   - API KEY：访问密钥（可选）
3. 点击确定

**特点：**
- `provider` 字段固定为 "custom"
- 完全自由配置
- 适合私有部署或非标准 API

---

## 常见问题

### Q1: 为什么同一个模板可以添加多次？

**A:** 当前实现基于 `provider` 字段判断，同一 `provider` 只能添加一次。如果需要支持多个相同类型的供应商（如多个 OpenAI 账号），建议：
- 使用不同的名称区分
- 或者修改过滤逻辑允许重复添加

### Q2: 如何修改现有供应商的 provider 字段？

**A:** 不建议直接修改 `provider` 字段，这会导致模板过滤混乱。正确做法：
1. 删除旧供应商
2. 重新添加（选择正确的模板或自定义）

### Q3: 迁移脚本安全吗？

**A:** 是的，迁移脚本：
- ✅ 只更新 `provider` 字段
- ✅ 不会删除任何数据
- ✅ 跳过已正确的记录
- ✅ 提供详细的执行日志

但建议先备份数据库：
```bash
cp dev.db dev.db.backup
```

### Q4: 如何添加新的供应商模板？

**A:** 编辑 `backend-ts/src/constants/provider-templates.ts`：

```typescript
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  // ... 现有模板
  {
    id: 'your-provider-id',      // 唯一标识符
    name: '你的供应商',           // 显示名称
    protocol: 'openai',          // 协议类型
    defaultApiUrl: 'https://...', // 默认 API 地址
    avatarUrl: '/static/images/...', // 图标路径（可选）
    attributes: { ... }          // 额外属性（可选）
  },
];
```

同时更新前端的 `getProviderTypeLabel` 函数：
```javascript
const typeMap = {
  // ... 现有映射
  'your-provider-id': '你的供应商'
}
```

---

## 技术细节

### 数据流

```
前端创建请求
  ↓
POST /providers
body: { name, apiUrl, apiKey, provider, template_id? }
  ↓
后端 Controller
  ↓
ModelService.addProvider()
  - 如果有 template_id：provider = template.id
  - 如果自定义：provider = "custom"
  ↓
保存到数据库
ModelProvider.provider = "siliconflow" | "openai" | "custom" | ...
  ↓
前端刷新列表
availableTemplates 过滤掉已添加的 provider
```

### 关键字段说明

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `id` | String | 数据库主键 | "ck123abc..." |
| `name` | String | 显示名称 | "硅基流动" |
| `provider` | String | 供应商标识符 | "siliconflow" |
| `protocol` | String | 通信协议 | "openai" |
| `apiUrl` | String | API 端点 | "https://api.siliconflow.cn/v1/" |
| `apiKey` | String | 访问密钥 | "sk-..." |

**注意：**
- `id` 是唯一的数据库 ID
- `provider` 是业务层面的类型标识
- `name` 是用户友好的显示名称

---

## 故障排查

### 问题：模板过滤不工作

**检查步骤：**
1. 运行测试脚本查看 provider 字段是否正确
   ```bash
   npx ts-node test-provider-field.ts
   ```
2. 检查浏览器控制台是否有错误
3. 确认后端返回的数据包含 `provider` 字段

**可能原因：**
- 数据库中 provider 字段为空
- 前端缓存未刷新
- 后端代码未重启

### 问题：悬停按钮不显示

**检查步骤：**
1. 确认使用的是最新代码
2. 清除浏览器缓存
3. 检查 CSS 是否正确加载

**可能原因：**
- Tailwind CSS 未正确编译
- 浏览器不支持某些 CSS 特性
- z-index 层级问题

### 问题：创建供应商失败

**检查步骤：**
1. 查看后端日志
2. 检查网络请求的 payload
3. 确认数据库连接正常

**常见错误：**
- API 地址格式不正确
- 缺少必填字段
- 权限验证失败

---

## 下一步优化建议

1. **支持多账户同类型供应商**
   - 修改过滤逻辑，允许同一 provider 添加多次
   - 使用组合键（provider + name）判断重复

2. **供应商健康检查**
   - 定期检测 API 连通性
   - 显示供应商状态（在线/离线）

3. **批量导入/导出**
   - 支持 JSON 格式的配置导入
   - 一键备份所有供应商配置

4. **使用统计**
   - 记录每个供应商的调用次数
   - 显示 Token 消耗统计

---

## 相关文档

- [完整重构报告](./provider-management-refactoring.md)
- [后端 API 文档](../../backend-ts/docs/)
- [前端组件文档](../)

---

**最后更新：** 2026-04-09  
**维护者：** AI Assistant
