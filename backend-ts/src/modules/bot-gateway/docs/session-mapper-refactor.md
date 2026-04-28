# SessionMapper 重构说明 - externalId 职责分离

## 重构目标

将 `externalId` 的组装逻辑从 `SessionMapperService` 移到调用者,实现**单一职责原则**和**开闭原则**。

## 设计理由

1. **职责分离**: `SessionMapperService` 只负责"获取或创建会话",不关心 `externalId` 如何组装
2. **扩展性**: 不同平台或未来可能有不同的隔离策略,由调用者决定更灵活
3. **可测试性**: 调用者可以自定义 `externalId` 格式,便于单元测试

## 修改内容

### 1. SessionMapperService 接口变更

#### getOrCreateBotSession

**修改前**:
```typescript
async getOrCreateBotSession(
  botId: string,
  platform: string,
  type: 'private' | 'group',
  nativeId: string,
  defaultCharacterId?: string,
  defaultModelId?: string,
): Promise<any>
```

**修改后**:
```typescript
/**
 * @param botId Bot 实例 ID
 * @param externalId 外部会话标识(由调用者根据平台策略组装)
 * @param platform 来源平台
 * @param defaultCharacterId 默认角色 ID(必填)
 * @param defaultModelId 默认模型 ID(可选)
 * @param title 会话标题(可选,不提供则自动生成)
 */
async getOrCreateBotSession(
  botId: string,
  externalId: string,
  platform: string,
  defaultCharacterId: string,
  defaultModelId?: string,
  title?: string,
): Promise<any>
```

**关键变化**:
- ✅ 移除 `type` 和 `nativeId` 参数
- ✅ 新增 `externalId` 参数(由调用者提供)
- ✅ `defaultCharacterId` 改为必填
- ✅ 新增可选的 `title` 参数

#### findByExternalId

**修改前**:
```typescript
async findByExternalId(
  botId: string,
  platform: string,
  type: 'private' | 'group',
  nativeId: string,
  characterId?: string,
): Promise<any | null>
```

**修改后**:
```typescript
async findByExternalId(
  botId: string,
  externalId: string,
  characterId?: string,
): Promise<any | null>
```

#### findByExternalIdOnly

**修改前**:
```typescript
async findByExternalIdOnly(
  platform: string,
  type: 'private' | 'group',
  nativeId: string,
): Promise<any[]>
```

**修改后**:
```typescript
async findByExternalIdOnly(
  externalId: string,
): Promise<any[]>
```

### 2. 调用者更新 (BotOrchestrator)

**修改前**:
```typescript
const session = await this.sessionMapper.getOrCreateBotSession(
  botId,
  platform,
  type,
  nativeId,
  config.defaultCharacterId,
  config.defaultModelId,
);
```

**修改后**:
```typescript
// 2. 组装 externalId(由调用者决定隔离策略)
const externalId = buildExternalId(platform, type, nativeId);

// 3. 获取或创建会话
const session = await this.sessionMapper.getOrCreateBotSession(
  botId,
  externalId,
  platform,
  config.defaultCharacterId,
  config.defaultModelId,
);
```

### 3. 内部工具方法调整

**generateBotSessionTitle → generateBotSessionTitleFromExternalId**

从解析 `platform/type/nativeId` 三个参数,改为直接从 `externalId` 字符串解析:

```typescript
private generateBotSessionTitleFromExternalId(externalId: string): string {
  // externalId 格式: "platform:type:nativeId"
  const parts = externalId.split(':');
  if (parts.length >= 3) {
    const platform = parts[0].toUpperCase();
    const type = parts[1] === 'group' ? '群聊' : '私聊';
    const nativeId = parts[2].slice(0, 8);
    return `${platform} ${type} ${nativeId}`;
  }
  return `Bot Session ${externalId.slice(0, 8)}`;
}
```

## 优势对比

### 修改前

```
BotOrchestrator                    SessionMapperService
     |                                    |
     |-- platform, type, nativeId ------>|-- 内部组装 externalId
     |                                    |-- 查询/创建会话
     |                                    |
```

**问题**:
- ❌ SessionMapper 耦合了 externalId 组装逻辑
- ❌ 无法支持不同的隔离策略
- ❌ 修改 externalId 格式需要改动 SessionMapper

### 修改后

```
BotOrchestrator                    SessionMapperService
     |                                    |
     |-- 自行组装 externalId              |
     |-- externalId --------------------->|-- 查询/创建会话
     |                                    |
```

**优势**:
- ✅ SessionMapper 职责单一,只关注会话管理
- ✅ 调用者可自定义 externalId 格式(如微信用 openid,钉钉用 unionId)
- ✅ 未来新增平台无需修改 SessionMapper
- ✅ 更容易编写单元测试(可以 mock externalId)

## 未来扩展示例

### 场景1: 微信平台使用不同的隔离策略

```typescript
// WeChat Orchestrator
const externalId = `wechat:${userOpenId}:${groupChatId || 'private'}`;
const session = await this.sessionMapper.getOrCreateBotSession(
  botId,
  externalId,
  'wechat',
  config.defaultCharacterId,
);
```

### 场景2: 按用户维度隔离(而非按会话)

```typescript
// 同一用户的所有消息共享一个会话
const externalId = `platform:user:${userId}`;
const session = await this.sessionMapper.getOrCreateBotSession(
  botId,
  externalId,
  platform,
  config.defaultCharacterId,
);
```

### 场景3: 自定义标题

```typescript
const session = await this.sessionMapper.getOrCreateBotSession(
  botId,
  externalId,
  platform,
  config.defaultCharacterId,
  config.defaultModelId,
  'VIP客户专属客服',  // 自定义标题
);
```

## 兼容性说明

- ✅ `buildExternalId` 工具函数保持不变,仍可在调用者中使用
- ✅ 数据库 schema 无需修改
- ✅ 现有会话数据完全兼容

## 注意事项

1. **调用者责任**: 调用者必须确保 `externalId` 的唯一性和一致性
2. **格式约定**: 建议保持 `platform:type:nativeId` 格式,便于解析和调试
3. **测试覆盖**: 建议在调用者层面测试不同的 externalId 组装策略
