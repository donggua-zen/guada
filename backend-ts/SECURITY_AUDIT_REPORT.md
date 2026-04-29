# TypeScript 后端认证安全审计与修复报告

**生成时间**: 2026-04-05  
**审计范围**: 所有核心业务模块  
**审计标准**: JWT 认证 + 用户身份提取 + 资源归属权验证

---

## 📊 执行摘要

### 问题统计

| 模块 | 接口数 | 缺失AuthGuard | 硬编码UserID | 缺少归属权验证 | 风险等级 |
|------|--------|--------------|-------------|--------------|---------|
| Knowledge Base | 15 | 0 | 0 | 0 | 安全 |
| ❌ Models | 7 | 7 | 7 | 0 | 🔴 高危 |
| ❌ Characters | 6 | 6 | 6 | 0* | 🔴 高危 |
| ❌ Sessions | 6 | 6 | 6 | 1 | 🔴 高危 |
| ❌ Users | 11 | 11 | 11 | 1 | 🔴 严重 |
| ⚠️ MCP Servers | 7 | 7 | 0 | 7 | 🟡 中危 |
| **总计** | **52** | **37** | **30** | **9** | - |

*Characters Service 层有验证逻辑，但因 Controller 传参错误而失效

---

## 🔧 已完成的修复

### 1. Models Module（模型管理模块）

**修复文件**:
- `src/modules/models/models.controller.ts`
- `src/modules/models/model.service.ts`
- `src/common/database/model.repository.ts`

**修复内容**:
```typescript
// Controller 层
@Controller('api/v1')
@UseGuards(AuthGuard)  // ← 添加认证守卫
export class ModelsController {
  
  @Get('models')
  async getModels(@CurrentUser() user: any) {  // ← 提取用户
    return this.modelService.getModelsAndProviders(user.id);  // ← 使用真实 UserID
  }
  
  @Post('providers')
  async createProvider(@Body() body: any, @CurrentUser() user: any) {
    return this.modelService.addProvider(user.id, body.name, body.api_key, body.api_url);
  }
  
  // ... 其他方法类似修复
}

// Service 层 - 添加权限验证
async addModel(data: any, userId: string) {
  // 验证 provider 是否属于当前用户
  const provider = await this.modelRepo.getProviderById(data.providerId);
  if (!provider || provider.userId !== userId) {
    throw new Error('Provider not found or unauthorized');
  }
  return this.modelRepo.createModel(data);
}

async updateModel(modelId: string, data: any, userId: string) {
  const model = await this.modelRepo.findById(modelId);
  if (!model) throw new Error('Model not found');
  
  const provider = await this.modelRepo.getProviderById(model.providerId);
  if (!provider || provider.userId !== userId) {
    throw new Error('Unauthorized');
  }
  
  return this.modelRepo.updateModel(modelId, data);
}
```

**修复的接口** (7个):
- `GET /api/v1/models`
- `POST /api/v1/models`
- `PUT /api/v1/models/:id`
- `DELETE /api/v1/models/:id`
- `POST /api/v1/providers`
- `PUT /api/v1/providers/:id`
- `DELETE /api/v1/providers/:id`
- `GET /api/v1/providers/:id/remote_models`

---

## ⚠️ 待修复的模块

### 2. Characters Module（角色管理模块）

**问题**: 
- Controller 未应用 AuthGuard
- 硬编码 `'current-user-id'`
- Service 层有验证逻辑但未生效

**需要修改的文件**:
- `src/modules/characters/characters.controller.ts`
- `src/modules/characters/character.service.ts` (已有验证，无需修改)

**修复方案**:
```typescript
// characters.controller.ts
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('api/v1')
@UseGuards(AuthGuard)  // ← 添加
export class CharactersController {
  
  @Get('characters')
  async getCharacters(@CurrentUser() user: any) {  // ← 添加参数
    return this.characterService.getCharactersByUser(user.id);  // ← 替换
  }
  
  @Get('shared/characters')
  @UseGuards()  // ← 公开接口，移除守卫或单独处理
  async getSharedCharacters() {
    return this.characterService.getSharedCharacters();
  }
  
  @Post('characters')
  async createCharacter(@Body() data: any, @CurrentUser() user: any) {
    return this.characterService.createCharacter(user.id, data);
  }
  
  @Put('characters/:id')
  async updateCharacter(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
    return this.characterService.updateCharacter(id, user.id, data);
  }
  
  @Delete('characters/:id')
  async deleteCharacter(@Param('id') id: string, @CurrentUser() user: any) {
    await this.characterService.deleteCharacter(id, user.id);
    return { success: true };
  }
  
  @Post('characters/:id/avatars')
  @UseInterceptors(FileInterceptor('avatar'))
  async uploadAvatar(@Param('id') id: string, @UploadedFile() file: any, @CurrentUser() user: any) {
    const fileUrl = `/uploads/${file.originalname}`;
    return this.characterService.uploadAvatar(id, user.id, fileUrl);
  }
}
```

---

### 3. Sessions Module（会话管理模块）

**问题**:
- Controller 未应用 AuthGuard
- 硬编码 `'current-user-id'`
- `GET /sessions/:id` 在 Service 层缺少权限验证

**需要修改的文件**:
- `src/modules/chat/sessions.controller.ts`
- `src/modules/chat/session.service.ts`

**修复方案**:

#### sessions.controller.ts
```typescript
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class SessionsController {
  
  @Get('sessions')
  async getSessions(@CurrentUser() user: any) {
    return this.sessionService.getSessionsByUser(user.id);
  }
  
  @Post('sessions')
  async createSession(@Body() data: any, @CurrentUser() user: any) {
    return this.sessionService.createSession(user.id, data);
  }
  
  @Get('sessions/:id')
  async getSession(@Param('id') id: string, @CurrentUser() user: any) {
    return this.sessionService.getSessionById(id, user.id);  // ← 传递 userId
  }
  
  @Put('sessions/:id')
  async updateSession(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
    return this.sessionService.updateSession(id, user.id, data);
  }
  
  @Delete('sessions/:id')
  async deleteSession(@Param('id') id: string, @CurrentUser() user: any) {
    await this.sessionService.deleteSession(id, user.id);
    return { success: true };
  }
  
  @Post('sessions/:id/generate-title')
  async generateTitle(@Param('id') id: string, @CurrentUser() user: any) {
    return this.sessionService.generateTitle(id, user.id);
  }
}
```

#### session.service.ts
```typescript
// 添加权限验证到 getSessionById
async getSessionById(sessionId: string, userId?: string) {
  const session = await this.sessionRepo.findById(sessionId);
  
  // 如果提供了 userId，验证归属权
  if (userId && (!session || session.userId !== userId)) {
    throw new Error('Session not found or unauthorized');
  }
  
  return session;
}

// 为 generateTitle 添加 userId 参数
async generateTitle(sessionId: string, userId: string) {
  const session = await this.getSessionById(sessionId, userId);
  // ... 实现标题生成逻辑
  return { success: true, title: 'Generated Title' };
}
```

---

### 4. Users Module（用户管理模块）

**问题**:
- Controller 未应用 AuthGuard
- 硬编码 `'current-user-id'`
- 密码重置接口存在严重安全漏洞
- 子账户更新缺少权限校验

**需要修改的文件**:
- `src/modules/users/users.controller.ts`
- `src/modules/users/user.service.ts`

**修复方案**:

#### users.controller.ts
```typescript
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('api/v1')
@UseGuards(AuthGuard)
export class UsersController {
  
  @Get('user/profile')
  async getProfile(@CurrentUser() user: any) {
    return this.userService.getProfile(user.id);
  }
  
  @Put('user/profile')
  async updateProfile(@Body() data: any, @CurrentUser() user: any) {
    return this.userService.updateProfile(user.id, data);
  }
  
  @Put('user/password')
  async updatePassword(@Body() body: { old_password: string; new_password: string }, @CurrentUser() user: any) {
    return this.userService.changePassword(user.id, body.old_password, body.new_password);
  }
  
  @Post('subaccounts')
  async createSubAccount(@Body() data: any, @CurrentUser() user: any) {
    return this.userService.createSubAccount(user.id, data);
  }
  
  @Get('subaccounts')
  async getSubAccounts(@CurrentUser() user: any) {
    return this.userService.getSubAccounts(user.id);
  }
  
  @Delete('subaccounts/:id')
  async deleteSubAccount(@Param('id') id: string, @CurrentUser() user: any) {
    await this.userService.deleteSubAccount(id, user.id);
    return { success: true };
  }
  
  @Put('subaccounts/:id')
  async updateSubAccount(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
    // 验证：仅主账户或本人可更新
    const targetUser = await this.userService.getProfile(id);
    if (targetUser.parentId !== user.id && targetUser.id !== user.id) {
      throw new Error('无权更新该账户');
    }
    return this.userService.updateProfile(id, data);
  }
  
  @Post('user/avatars')
  @UseInterceptors(FileInterceptor('avatar'))
  async uploadAvatar(@UploadedFile() file: any, @CurrentUser() user: any) {
    const fileUrl = `/uploads/${file.originalname}`;
    return this.userService.uploadAvatar(user.id, fileUrl);
  }
  
  // 密码重置接口应该移除或严格限制
  @Get('user/reset-password')
  checkResetPassword() {
    if (!this.userService.isPasswordResetAllowed()) {
      throw new Error('密码已设置，无法重置');
    }
  }
  
  @Post('user/reset-password')
  async resetPassword(@Body() body: { type: string; password: string; phone?: string; email?: string }) {
    if (!this.userService.isPasswordResetAllowed()) {
      throw new Error('密码已设置，无法重置');
    }
    
    await this.userService.resetPrimaryPassword(body.password, body.phone, body.email);
    this.userService.markPasswordAsSet();
    return { success: true };
  }
}
```

---

### 5. MCP Servers Module（MCP 服务器管理模块）

**特殊说明**: 
MCP Servers 可能是全局共享资源（如系统级配置），也可能是用户私有资源。需要根据业务需求决定：

#### 方案 A：如果是全局共享资源
```typescript
// 不需要用户级权限验证，但需要管理员权限
@Controller('api/v1/mcp-servers')
@UseGuards(AuthGuard, AdminGuard)  // 仅管理员可操作
export class McpServersController {
  // ... 保持现有逻辑
}
```

#### 方案 B：如果是用户私有资源
需要在 Prisma Schema 中添加 `userId` 字段，然后应用与其他模块相同的修复模式。

**建议**: 先确认业务需求，再决定采用哪种方案。

---

## 🛡️ 安全加固建议

### 1. 统一认证中间件
在 `main.ts` 中应用全局守卫（排除公开接口）：
```typescript
import { AuthGuard } from './modules/auth/auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 应用全局守卫（可选）
  // app.useGlobalGuards(new AuthGuard());
  
  await app.listen(3000);
}
```

### 2. 速率限制
防止暴力破解和 API 滥用：
```bash
npm install @nestjs/throttler
```

```typescript
// app.module.ts
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,     // 1 分钟
      limit: 10,      // 最多 10 次请求
    }]),
  ],
})
export class AppModule {}
```

### 3. 审计日志
记录所有敏感操作：
```typescript
@Injectable()
export class AuditLogService {
  async log(userId: string, action: string, resource: string, details?: any) {
    console.log(`[AUDIT] ${new Date().toISOString()} | User: ${userId} | Action: ${action} | Resource: ${resource}`, details);
    // 保存到数据库或日志文件
  }
}
```

### 4. 输入验证
使用 DTOs 和 class-validator：
```typescript
import { IsString, IsEmail, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;
  
  @IsString()
  @MinLength(8)
  password: string;
}
```

---

## 📋 修复优先级

### P0 - 立即修复（严重安全漏洞）
1. Models Module - 已完成
2. ❌ Users Module - 密码重置漏洞
3. ❌ Sessions Module - 会话泄露风险

### P1 - 高优先级（高危漏洞）
4. ❌ Characters Module - 越权访问
5. ❌ Sessions Module - 缺少归属权验证

### P2 - 中优先级（需确认业务需求）
6. ⚠️ MCP Servers Module - 确认是否为共享资源

---

## 验证清单

修复完成后，请执行以下测试：

- [ ] 未登录用户访问受保护接口返回 401
- [ ] 用户 A 无法访问用户 B 的资源（返回 403）
- [ ] 所有写操作（POST/PUT/DELETE）都验证了资源归属权
- [ ] Token 过期后自动拒绝访问
- [ ] 密码重置接口仅在允许状态下可用
- [ ] 子账户管理有正确的权限控制

---

## 📝 总结

### 已完成
- Knowledge Base Module（15个接口）- 完全合规
- Models Module（7个接口）- 已修复

### 待修复
- ❌ Characters Module（6个接口）- 需要应用 AuthGuard
- ❌ Sessions Module（6个接口）- 需要应用 AuthGuard + 补充权限验证
- ❌ Users Module（11个接口）- 需要应用 AuthGuard + 修复密码重置漏洞
- ⚠️ MCP Servers Module（7个接口）- 需确认业务需求

### 关键发现
1. **Service 层设计良好**：大部分 Service 已有权限验证逻辑，只需 Controller 正确传递用户 ID
2. **认证基础设施完善**：AuthGuard 和 CurrentUser 装饰器已就绪，可直接使用
3. **主要问题是遗漏**：开发者忘记应用守卫和提取用户信息，而非架构缺陷

### 下一步行动
1. 按照本报告提供的代码片段修复剩余模块
2. 运行集成测试验证所有接口
3. 考虑实施全局守卫简化开发
4. 添加速率限制和审计日志增强安全性
