# defaultCharacterId 字段重构说明

## 变更概述

将 `defaultCharacterId` 从可选字段改为必填字段,确保对话流程正常运行。

## 变更原因

在 `session-mapper.service.ts` 中,如果 `defaultCharacterId` 为空且没有配置默认模型,会导致对话流程异常(第 86-89 行会抛出错误)。为避免这种情况,将 `defaultCharacterId` 设置为创建机器人时的必填字段。

## 修改内容

### 1. 数据库 Schema (`prisma/schema.prisma`)

**变更前**:
```prisma
defaultCharacterId String? @map("default_character_id")
```

**变更后**:
```prisma
defaultCharacterId String   @map("default_character_id")  // 默认角色ID(必填,用于对话流程)
```

### 2. TypeScript 接口 (`src/modules/bot-gateway/interfaces/bot-platform.interface.ts`)

**变更前**:
```typescript
/** 关联的默认角色ID(可选) */
defaultCharacterId?: string;
```

**变更后**:
```typescript
/** 关联的默认角色ID(必填,用于对话流程) */
defaultCharacterId: string;
```

### 3. DTO 定义 (`src/modules/bot-gateway/dto/bot-admin.dto.ts`)

**CreateBotDto**:
```typescript
// 变更前
defaultCharacterId?: string;

// 变更后
defaultCharacterId: string;   // 默认关联的角色ID(必填)
```

**UpdateBotDto**:
```typescript
// 保持可选(更新时可以不修改此字段)
defaultCharacterId?: string;  // 更新时可选
```

### 4. 业务逻辑验证 (`src/modules/bot-gateway/services/bot-admin.service.ts`)

添加了创建时的验证逻辑:
```typescript
// 验证 defaultCharacterId 必填
if (!dto.defaultCharacterId) {
  throw new BadRequestException('defaultCharacterId is required for bot instance');
}
```

### 5. 实例管理器 (`src/modules/bot-gateway/services/bot-instance-manager.service.ts`)

**变更前**:
```typescript
defaultCharacterId: bot.defaultCharacterId || undefined,
```

**变更后**:
```typescript
defaultCharacterId: bot.defaultCharacterId,  // 必填字段
```

### 6. API 文档 (`src/modules/bot-gateway/docs/API.md`)

更新了所有示例和字段说明:
- 将示例中的 `"defaultCharacterId": null` 改为 `"defaultCharacterId": "char-cuid-123"`
- 字段说明中标注为 **必填**

### 7. 数据迁移脚本 (`src/scripts/fix-bot-instances.ts`)

创建了修复脚本,为现有的 NULL 记录设置默认的 character ID:
```bash
npx ts-node src/scripts/fix-bot-instances.ts
```

## 执行步骤

1. **运行修复脚本**(为现有记录设置默认值):
   ```bash
   npx ts-node src/scripts/fix-bot-instances.ts
   ```

2. **同步数据库 schema**:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

3. **重启服务验证**:
   ```bash
   npm run start:dev
   ```

## 影响范围

- ✅ 创建机器人时必须提供 `defaultCharacterId`
- ✅ 更新机器人时 `defaultCharacterId` 可选
- ✅ 现有记录的 `defaultCharacterId` 已自动设置为第一个可用角色
- ✅ 对话流程不再因缺少 `defaultCharacterId` 而失败

## 注意事项

1. **前端适配**: 前端创建机器人表单需要添加角色选择器,并确保用户选择一个角色
2. **错误提示**: 如果用户未选择角色,后端会返回明确的错误信息: `"defaultCharacterId is required for bot instance"`
3. **向后兼容**: 更新接口保持可选,不影响现有功能
