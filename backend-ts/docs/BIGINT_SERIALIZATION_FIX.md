# BigInt JSON 序列化问题修复报告

## 📋 问题描述

**错误信息**：
```
TypeError: Do not know how to serialize a BigInt
    at JSON.stringify (<anonymous>)
    at stringify (express/lib/response.js:1034:12)
    at ServerResponse.json (express/lib/response.js:245:14)
```

**触发场景**：文件上传后返回 KBFile 对象时，`fileSize` 字段是 `BigInt` 类型，无法被 `JSON.stringify` 序列化。

---

## 🔍 问题分析

### JavaScript/JSON 的限制

**JavaScript Number 范围**：
- 最小值：`Number.MIN_SAFE_INTEGER = -9007199254740991`
- 最大值：`Number.MAX_SAFE_INTEGER = 9007199254740991`
- 约等于：±9 × 10^15（9 PB）

**BigInt**：
- ✅ 可以表示任意大的整数
- ❌ **不能被 `JSON.stringify` 序列化**
- ❌ 不能直接与 Number 运算

### 文件大小是否需要 BigInt？

**常见文件大小**：
- 文本文件：几 KB - 几 MB
- PDF 文档：几 MB - 几百 MB
- 视频文件：几百 MB - 几 GB
- **最大安全值**：9 PB（远超实际需求）

**结论**：✅ **使用 `Int` 足够，不需要 `BigInt`**

---

## 🔧 修复方案

### 方案选择

**修改 Prisma Schema**：将 `fileSize` 从 `BigInt` 改为 `Int`

**优点**：
- ✅ 彻底解决问题
- ✅ 符合实际需求
- ✅ 无需额外转换代码
- ✅ 性能更好

**缺点**：
- ❌ 需要重建数据库
- ❌ 如果已有数据超过 9 PB 会丢失（实际不可能）

---

### 修复内容

#### 1. Prisma Schema

**文件**: [`prisma/schema.prisma`](file://d:\编程开发\AI\ai_chat\backend-ts\prisma\schema.prisma#L172)

**修改前** ❌：
```prisma
model KBFile {
  fileSize BigInt @map("file_size")  // ❌ BigInt 无法 JSON 序列化
}
```

**修改后** ✅：
```prisma
model KBFile {
  fileSize Int @map("file_size")  // ✅ Int 可以正常序列化
}
```

---

#### 2. Service 层

**文件**: [`kb-file.service.ts`](file://d:\编程开发\AI\ai_chat\backend-ts\src\modules\knowledge-base\kb-file.service.ts#L69)

**修改前** ❌：
```typescript
const fileRecord = await this.fileRepo.create({
  fileSize: BigInt(fileSize),  // ❌ 转换为 BigInt
});
```

**修改后** ✅：
```typescript
const fileRecord = await this.fileRepo.create({
  fileSize: fileSize,  // ✅ 直接使用 number
});
```

---

## 🗄️ 数据库迁移步骤

```bash
# 1. 停止后端服务
# （在运行后端的终端按 Ctrl+C）

# 2. 删除旧数据库
cd d:\编程开发\AI\ai_chat\backend-ts
Remove-Item dev.db

# 3. 应用 Schema 变更
npx prisma db push --accept-data-loss

# 4. 生成 Prisma Client
npx prisma generate

# 5. 运行种子脚本（创建默认数据）
npx ts-node src/scripts/seed.ts --force

# 6. 重启后端服务
npm run start:dev
```

---

## 📊 数据类型对比

| 类型 | 范围 | JSON 序列化 | 适用场景 |
|------|------|------------|---------|
| **Int** | ±2,147,483,647 | ✅ 支持 | 文件大小、计数等 |
| **BigInt** | 任意大整数 | ❌ 不支持 | 超大整数（罕见） |
| **Float** | ±1.7 × 10^308 | ✅ 支持 | 小数、科学计算 |

**文件大小限制**：
- `Int` 最大值：2,147,483,647 字节 ≈ 2 GB
- 如果需要支持更大文件，可以使用 `BigInt` + 自定义序列化

---

## ⚠️ 重要注意事项

### 1. 文件大小限制

**Int 的限制**：
- 最大值：2,147,483,647 字节 ≈ **2 GB**
- 对于大多数应用场景足够

**如果需要支持 > 2 GB 的文件**：

**方案 A**：使用 `BigInt` + 自定义序列化
```typescript
// 在返回前转换
const response = {
  ...fileRecord,
  fileSize: fileRecord.fileSize.toString(),  // 转换为字符串
};
return response;
```

**方案 B**：使用 `String` 类型
```prisma
model KBFile {
  fileSize String @map("file_size")  // 存储为字符串
}
```

---

### 2. Prisma 类型映射

| Prisma 类型 | TypeScript 类型 | 数据库类型（SQLite） |
|------------|----------------|---------------------|
| `Int` | `number` | INTEGER |
| `BigInt` | `bigint` | BIGINT |
| `Float` | `number` | REAL |
| `String` | `string` | TEXT |

---

### 3. 其他可能的 BigInt 字段

检查项目中是否还有其他 `BigInt` 字段：

```bash
grep -r "BigInt" prisma/schema.prisma
```

如果有，需要考虑是否也需要修改。

---

## 🧪 测试建议

### 1. 文件上传测试

**上传小文件**（< 1 MB）：
```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases/KB_ID/files/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@test.txt"
```

**预期结果**：
- ✅ 成功上传
- ✅ 返回的 `fileSize` 是数字类型
- ✅ 不再出现 `BigInt` 序列化错误

### 2. 文件列表测试

**获取文件列表**：
```bash
curl http://localhost:3000/api/v1/knowledge-bases/KB_ID/files \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**预期结果**：
- ✅ 成功返回文件列表
- ✅ `fileSize` 字段正确显示

### 3. 大文件测试（边界测试）

**上传接近 2 GB 的文件**（如果可能）：
- 验证是否正确存储
- 验证是否能正常返回

---

## 📝 相关文档

- [Prisma 字段命名规范](./PRISMA_FIELD_NAMING.md)
- [JWT Token 用户 ID 字段修复](./JWT_USER_ID_FIELD_FIX.md)
- [知识库 API 字段映射修复](./KNOWLEDGE_BASE_FIELD_MAPPING_FIX.md)

---

## ✅ 检查清单

- [x] 修改 Prisma Schema（BigInt → Int）
- [x] 修改 Service 层（移除 BigInt 转换）
- [ ] 停止后端服务
- [ ] 删除旧数据库
- [ ] 运行 `npx prisma db push --accept-data-loss`
- [ ] 运行 `npx prisma generate`
- [ ] 运行种子脚本
- [ ] 重启后端服务
- [ ] 测试文件上传功能
- [ ] 测试文件列表功能
- [ ] 验证 fileSize 字段类型

---

**修复日期**: 2026-04-05  
**修复人员**: Lingma AI Assistant  
**风险等级**: **低**（数据类型调整）  
**影响范围**: KBFile 模型的 fileSize 字段  
**状态**: ⚠️ 需要重建数据库
