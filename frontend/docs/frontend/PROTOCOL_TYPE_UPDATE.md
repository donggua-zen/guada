# 供应商协议类型支持 - 功能更新

## 更新日期
2026-04-09

## 更新概述

本次更新为供应商管理添加了**协议类型（protocol）**字段支持，并实现了基于供应商类型的**字段编辑权限控制**。

---

## 一、新增功能

### 1. 协议类型下拉框

在供应商编辑/创建表单中新增了"协议类型"字段，支持以下选项：

- **OpenAI** (`openai`) - 标准 OpenAI API 协议
- **OpenAI-Response** (`openai-response`) - OpenAI Response API 协议
- **Gemini** (`gemini`) - Google Gemini API 协议
- **Anthropic** (`anthropic`) - Anthropic Claude API 协议

### 2. 字段编辑权限控制

根据供应商类型（`provider` 字段）控制字段的可编辑性：

#### Custom 类型（自定义供应商）
✅ **可编辑字段：**
- 名字（name）
- 协议类型（protocol）
- API地址（apiUrl）
- API KEY（apiKey）

**适用场景：** 用户手动创建的自定义供应商

#### 非 Custom 类型（从模板添加）
✅ **可编辑字段：**
- API KEY（apiKey）

❌ **禁止编辑字段：**
- 名字（name）- 禁用
- 协议类型（protocol）- 禁用
- API地址（apiUrl）- 禁用

**适用场景：** 从模板添加的供应商（如硅基流动、OpenAI、DeepSeek 等）

### 3. 用户提示

当编辑从模板添加的供应商时，表单底部会显示提示信息：

> ℹ️ 提示：从模板添加的供应商，名称、协议和API地址不可修改

---

## 二、技术实现

### 前端修改

#### 1. ModelsSettings.vue

**新增计算属性：**
```javascript
// 判断是否为自定义供应商
const isCustomProvider = computed(() => {
    return currentProviderEdit.value.provider === 'custom';
});
```

**表单字段绑定：**
```vue
<!-- 名字 - 仅 custom 可编辑 -->
<el-input v-model="currentProviderEdit.name" 
    :disabled="!isCustomProvider" />

<!-- 协议类型 - 新增下拉框 -->
<el-select v-model="currentProviderEdit.protocol" 
    :disabled="!isCustomProvider">
    <el-option label="OpenAI" value="openai" />
    <el-option label="OpenAI-Response" value="openai-response" />
    <el-option label="Gemini" value="gemini" />
    <el-option label="Anthropic" value="anthropic" />
</el-select>

<!-- API地址 - 仅 custom 可编辑 -->
<el-input v-model="currentProviderEdit.apiUrl" 
    :disabled="!isCustomProvider" />

<!-- 提示信息 -->
<el-alert v-if="!isCustomProvider && isProviderEditMode" 
    title="提示：从模板添加的供应商，名称、协议和API地址不可修改" 
    type="info" :closable="false" show-icon />
```

**保存逻辑优化：**
```javascript
const handleSaveProvider = async () => {
    if (isProviderEditMode.value) {
        const updateData = {
            name: currentProviderEdit.value.name,
            apiKey: currentProviderEdit.value.apiKey,
            apiUrl: currentProviderEdit.value.apiUrl,
            protocol: currentProviderEdit.value.protocol
        };
        
        // 只有自定义供应商才能修改 name、apiUrl、protocol
        if (!isCustomProvider.value) {
            delete updateData.name;
            delete updateData.apiUrl;
            delete updateData.protocol;
        }
        
        await apiService.updateProvider(currentProviderId.value, updateData);
    }
};
```

**数据结构扩展：**
```javascript
const currentProviderEdit = ref({
    name: "",
    apiUrl: "",
    apiKey: "",
    provider: "custom",
    protocol: "openai"  // 默认协议类型
});
```

#### 2. 类型定义更新（api.ts）

```typescript
export interface ModelProvider {
    id: string
    name: string
    provider?: string      // 供应商标识符
    protocol?: string      // 协议类型
    apiUrl?: string
    apiKey?: string
    // ... 其他字段
}

export interface ProviderTemplate {
    id: string
    name: string
    protocol?: string      // 模板默认协议
    defaultApiUrl?: string
    // ... 其他字段
}
```

### 后端修改

#### 1. ModelService.ts

**创建供应商时设置 protocol：**
```typescript
async addProvider(userId: string, name: string, apiKey: string, apiUrl: string, 
                  templateId?: string, protocol?: string, ...) {
    let finalProtocol = protocol;
    
    if (templateId) {
        const template = PROVIDER_TEMPLATES.find(t => t.id === templateId);
        if (template) {
            finalProtocol = template.protocol;  // 使用模板的协议
            // ...
        }
    }
    
    return this.modelRepo.createProvider({
        userId,
        name: finalName,
        provider: finalProviderType,
        protocol: finalProtocol,  // ✅ 保存协议类型
        apiKey,
        apiUrl: finalApiUrl,
        // ...
    });
}
```

**更新供应商时的字段过滤：**
```typescript
async updateProvider(providerId: string, data: any, userId: string) {
    const provider = await this.modelRepo.getProviderById(providerId);
    
    // 如果不是 custom 类型，禁止修改 name、apiUrl、protocol
    if (provider.provider !== 'custom') {
        const { name, apiUrl, protocol, ...allowedData } = data;
        // 只允许更新 apiKey 等其他字段
        return this.modelRepo.updateProvider(providerId, allowedData);
    }
    
    // custom 类型可以更新所有字段
    return this.modelRepo.updateProvider(providerId, data);
}
```

#### 2. ModelsController.ts

控制器已支持传递 `protocol` 字段：
```typescript
@Post('providers')
async createProvider(@Body() body: any, @CurrentUser() user: any) {
    return this.modelService.addProvider(
        user.sub,
        body.name,
        body.apiKey || body.api_key,
        body.apiUrl || body.api_url,
        body.templateId || body.template_id,
        body.protocol,  // ✅ 传递协议类型
        body.avatarUrl || body.avatar_url,
        body.attributes,
        body.provider
    );
}
```

---

## 三、使用示例

### 场景 1：创建自定义供应商

1. 点击"添加自定义"按钮
2. 填写表单：
   - 名字：我的私有模型
   - 协议类型：选择 "OpenAI"
   - API地址：https://my-private-api.com/v1
   - API KEY：sk-xxx
3. 点击确定

**结果：**
- `provider` = "custom"
- `protocol` = "openai"
- 所有字段都可后续编辑

### 场景 2：从模板添加供应商

1. 在"可添加的供应商"中找到"硅基流动"
2. 点击"添加此供应商"
3. 确认添加

**结果：**
- `provider` = "siliconflow"
- `protocol` = "openai"（来自模板配置）
- `apiUrl` = "https://api.siliconflow.cn/v1/"（自动填充）
- 只能编辑 API KEY

### 场景 3：编辑模板供应商

1. 悬停已添加的"硅基流动"卡片
2. 点击"供应商设置"
3. 尝试修改名字或 API 地址

**结果：**
- 名字和 API 地址输入框呈禁用状态（灰色）
- 只能修改 API KEY
- 顶部显示提示信息

### 场景 4：编辑自定义供应商

1. 悬停自定义供应商卡片
2. 点击"供应商设置"
3. 可以自由修改所有字段

**结果：**
- 所有字段都可编辑
- 无禁用状态
- 无提示信息

---

## 四、数据库 Schema

Prisma Schema 中的 `ModelProvider` 模型已有 `protocol` 字段：

```prisma
model ModelProvider {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  name      String
  provider  String         // 供应商标识符
  protocol  String?        // ✅ 协议类型（可选）
  apiUrl    String   @map("api_url")
  apiKey    String?  @map("api_key")
  avatarUrl String?  @map("avatar_url")
  attributes Json?   
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  models    Model[]

  @@map("model_provider")
}
```

**注意：** `protocol` 字段为可选（`String?`），兼容旧数据。

---

## 五、协议类型说明

### OpenAI (`openai`)
- **适用：** 标准 OpenAI API 格式的提供商
- **示例：** OpenAI、硅基流动、DeepSeek、私有部署
- **特点：** 使用 `/v1/chat/completions` 端点

### OpenAI-Response (`openai-response`)
- **适用：** OpenAI Response API 格式
- **示例：** 某些特殊格式的 API
- **特点：** 使用不同的响应结构

### Gemini (`gemini`)
- **适用：** Google Gemini API
- **示例：** Google AI Studio
- **特点：** 使用 Gemini 特有的请求格式

### Anthropic (`anthropic`)
- **适用：** Anthropic Claude API
- **示例：** Claude 系列模型
- **特点：** 使用 Anthropic 特有的请求格式

---

## 六、测试建议

### 前端测试

1. **创建自定义供应商**
   - [ ] 协议类型下拉框正常显示
   - [ ] 可以选择不同的协议类型
   - [ ] 所有字段都可编辑
   - [ ] 保存后数据正确

2. **从模板添加供应商**
   - [ ] 自动使用模板的 protocol
   - [ ] 编辑时 name、protocol、apiUrl 禁用
   - [ ] 只显示提示信息
   - [ ] 只能修改 apiKey

3. **编辑现有供应商**
   - [ ] custom 类型：所有字段可编辑
   - [ ] 非 custom 类型：部分字段禁用
   - [ ] 保存后数据正确更新

### 后端测试

1. **创建供应商**
   ```bash
   # 测试自定义供应商
   POST /providers
   {
     "name": "测试",
     "apiUrl": "https://test.com",
     "apiKey": "sk-test",
     "provider": "custom",
     "protocol": "openai"
   }
   
   # 验证 protocol 字段已保存
   ```

2. **更新供应商**
   ```bash
   # 测试非 custom 类型
   PUT /providers/{id}
   {
     "name": "新名字",      // 应该被忽略
     "apiUrl": "https://new.com",  // 应该被忽略
     "protocol": "gemini",  // 应该被忽略
     "apiKey": "sk-new"     // 应该被更新
   }
   
   # 验证只有 apiKey 被更新
   ```

3. **数据库验证**
   ```sql
   SELECT id, name, provider, protocol, apiUrl 
   FROM model_provider;
   ```

---

## 七、注意事项

### 1. 向后兼容性
- 现有数据库中 `protocol` 字段可能为空
- 旧供应商仍可正常使用
- 建议运行数据迁移脚本补充 protocol 值

### 2. 数据迁移建议
```typescript
// 为现有供应商设置默认 protocol
UPDATE model_provider 
SET protocol = 'openai' 
WHERE protocol IS NULL AND provider != 'custom';

UPDATE model_provider 
SET protocol = 'openai' 
WHERE protocol IS NULL AND provider = 'custom';
```

### 3. 模板配置
确保 `provider-templates.ts` 中每个模板都配置了 `protocol`：

```typescript
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'siliconflow',
    name: '硅基流动',
    protocol: 'openai',  // ✅ 必须配置
    defaultApiUrl: 'https://api.siliconflow.cn/v1/',
    // ...
  },
  // ...
];
```

### 4. 前端缓存
修改后可能需要清除浏览器缓存以确保加载最新的组件代码。

---

## 八、未来扩展

### 可能的改进方向

1. **更多协议类型**
   - Azure OpenAI
   - Cohere
   - HuggingFace
   - 自定义协议

2. **协议自动检测**
   - 根据 apiUrl 自动推断协议类型
   - 提供"测试连接"功能验证协议

3. **协议特定配置**
   - 不同协议显示不同的配置项
   - 例如：Gemini 需要 project_id

4. **批量修改协议**
   - 支持批量切换供应商的协议类型
   - 适用于 API 升级场景

---

## 九、相关文件清单

### 前端文件
- ✅ `frontend/src/components/setting/ModelsSettings.vue`
- ✅ `frontend/src/types/api.ts`

### 后端文件
- ✅ `backend-ts/src/modules/models/model.service.ts`
- ✅ `backend-ts/src/modules/models/models.controller.ts`

### 文档文件
- 📄 `frontend/docs/frontend/provider-management-refactoring.md`
- 📄 `frontend/docs/frontend/PROVIDER_REFACTORING_GUIDE.md`
- 📄 `frontend/docs/frontend/PROTOCOL_TYPE_UPDATE.md`（本文档）

---

## 十、总结

本次更新成功实现了：

1. ✅ **协议类型支持** - 新增 protocol 字段，支持 4 种主流协议
2. ✅ **字段权限控制** - 基于 provider 类型智能控制可编辑字段
3. ✅ **用户体验优化** - 清晰的禁用状态和提示信息
4. ✅ **后端安全校验** - Service 层强制过滤不允许修改的字段
5. ✅ **类型安全** - 完整的 TypeScript 类型定义

所有修改已完成并通过语法检查，可以直接使用！🎉

---

**最后更新：** 2026-04-09  
**维护者：** AI Assistant
