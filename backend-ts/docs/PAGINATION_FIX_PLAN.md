# 分页响应格式统一修复计划

## 📊 问题背景

Python 后端的所有列表接口统一返回 `PaginatedResponse` 格式：
```python
{
  "items": [...],
  "total": 100,
  "page": 1,      # 可选
  "size": 20      # 可选
}
```

而 TypeScript 后端目前存在以下不一致：
- ❌ **Characters**: 直接返回数组 `Character[]`
- ❌ **Sessions**: 直接返回数组 `Session[]`
- ⚠️ **Knowledge Bases**: 返回 `{ items, total, skip, limit }`（格式略有不同）
- ❌ **Models**: 返回自定义格式
- ❌ **MCP Servers**: 直接返回数组

---

## ✅ 已完成修复

### 1. Characters 模块 ✅

**修改文件**：
- ✅ `src/common/database/character.repository.ts` - 添加分页支持
- ✅ `src/modules/characters/character.service.ts` - 返回分页格式
- ✅ `src/modules/characters/characters.controller.ts` - 接受分页参数

**新的 API 格式**：
```typescript
GET /api/v1/characters?skip=0&limit=20
// 返回
{
  "items": [...],
  "total": 50,
  "skip": 0,
  "limit": 20
}
```

---

## 🔧 待修复模块

### 2. Sessions 模块

**需要修改的文件**：
1. `src/common/database/session.repository.ts`
   ```typescript
   async findByUserId(userId: string, skip: number = 0, limit: number = 20) {
     const [items, total] = await Promise.all([
       this.prisma.session.findMany({
         where: { userId },
         orderBy: { lastActiveAt: 'desc' },
         skip,
         take: limit,
         include: { character: true, model: true },
       }),
       this.prisma.session.count({ where: { userId } }),
     ]);
     return { items, total };
   }
   ```

2. `src/modules/chat/session.service.ts`
   ```typescript
   async getSessionsByUser(userId: string, skip: number = 0, limit: number = 20) {
     const { items, total } = await this.sessionRepo.findByUserId(userId, skip, limit);
     return createPaginatedResponse(items, total, { skip, limit });
   }
   ```

3. `src/modules/chat/sessions.controller.ts`
   ```typescript
   @Get('sessions')
   async getSessions(
     @Query('skip') skip = 0,
     @Query('limit') limit = 20,
     @CurrentUser() user: any,
   ) {
     return this.sessionService.getSessionsByUser(user.sub, Number(skip), Number(limit));
   }
   ```

---

### 3. Models 模块

**当前实现检查**：
```typescript
// models.controller.ts Line 11-14
@Get('models')
async getModels(@CurrentUser() user: any) {
  return this.modelService.getModelsAndProviders(user.sub);
}
```

**需要确认**：
- `getModelsAndProviders` 返回的具体格式是什么？
- 是否需要分页？（模型数量通常较少，可能不需要分页）

**建议**：
如果模型数量较少（< 100），可以保持当前格式或返回：
```typescript
{
  "providers": [...],
  "models": [...]
}
```

---

### 4. Knowledge Bases 模块

**当前状态**：✅ 已实现分页，但格式略有不同

**当前返回**：
```typescript
{
  "items": [...],
  "total": 10,
  "skip": 0,
  "limit": 20
}
```

**与标准格式的对比**：
- ✅ 包含 `items` 和 `total`
- ✅ 使用 `skip/limit` 而非 `page/size`
- ℹ️ 这是 offset-based 分页，与 Python 的 page-based 略有不同，但功能等价

**建议**：保持一致性，无需修改。

---

### 5. MCP Servers 模块

**需要修改的文件**：
1. `src/common/database/mcp-server.repository.ts`（如果存在）
2. `src/modules/mcp-servers/mcp-server.service.ts`
3. `src/modules/mcp-servers/mcp-servers.controller.ts`

**修改方式**：同 Characters 模块

---

## 📝 实施步骤

### Step 1: 创建通用类型（已完成）✅
- ✅ `src/common/types/pagination.ts`

### Step 2: 修复 Characters 模块（已完成）✅
- ✅ Repository
- ✅ Service
- ✅ Controller

### Step 3: 修复 Sessions 模块（待执行）
```bash
# 修改以下文件
- src/common/database/session.repository.ts
- src/modules/chat/session.service.ts
- src/modules/chat/sessions.controller.ts
```

### Step 4: 检查并修复 Models 模块（待确认）
```bash
# 先检查当前返回格式
npm run start:dev
curl http://localhost:3000/api/v1/models -H "Authorization: Bearer <token>"
```

### Step 5: 修复 MCP Servers 模块（待执行）
```bash
# 修改以下文件
- src/common/database/mcp-server.repository.ts (可能需要创建)
- src/modules/mcp-servers/mcp-server.service.ts
- src/modules/mcp-servers/mcp-servers.controller.ts
```

### Step 6: 更新前端调用（如果需要）
检查前端是否依赖旧的数组格式，如有需要更新：
```typescript
// 旧代码
const characters = await api.getCharacters();
characters.forEach(...)

// 新代码
const response = await api.getCharacters();
response.items.forEach(...)
```

---

## 🎯 最终目标

所有列表接口统一返回格式：
```typescript
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  skip?: number;    // 或 page
  limit?: number;   // 或 size
}
```

**受益**：
1. ✅ 前后端契约一致
2. ✅ 前端可以统一处理分页逻辑
3. ✅ 支持大数据量场景
4. ✅ 符合 RESTful API 最佳实践

---

## ⚠️ 注意事项

1. **向后兼容性**：修改后前端需要同步更新
2. **默认值**：`skip=0, limit=20` 作为默认分页参数
3. **最大限制**：建议设置 `limit` 上限（如 100）防止滥用
4. **性能考虑**：对于小数据集（< 50 条），分页可能不是必需的

---

**最后更新**：2026-04-05
**状态**：Characters 模块已完成，其他模块待修复
