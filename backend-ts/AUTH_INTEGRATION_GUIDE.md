# 知识库模块认证集成指南

## 一、认证架构分析

### 1.1 现有认证模块结构

```
backend-ts/src/modules/auth/
├── auth.controller.ts      # 登录/注册接口
├── auth.guard.ts           # JWT 验证守卫
├── auth.module.ts          # 认证模块配置
├── auth.service.ts         # 认证业务逻辑
└── current-user.decorator.ts # 自定义用户装饰器
```

### 1.2 核心组件说明

#### AuthGuard (`auth.guard.ts`)
- **功能**：JWT Token 验证守卫
- **工作流程**：
  1. 从请求头提取 `Authorization: Bearer <token>`
  2. 使用 `JwtService` 验证 Token 有效性
  3. 将解码后的 payload 附加到 `request.user`
  4. 验证失败抛出 `UnauthorizedException`

```typescript
// JWT Payload 结构
{
  email: string,  // 用户邮箱
  sub: string,    // 用户 ID（重要！）
  iat: number,    // 签发时间
  exp: number     // 过期时间
}
```

#### CurrentUser 装饰器 (`current-user.decorator.ts`)
- **功能**：从请求中提取当前用户信息
- **使用方式**：`@CurrentUser() user: any`
- **返回值**：`request.user`（即 JWT payload）

```typescript
// 使用示例
async someMethod(@CurrentUser() user: any) {
  const userId = user.sub;  // 获取用户 ID
  const email = user.email; // 获取用户邮箱
}
```

#### AuthService (`auth.service.ts`)
- **login()**：验证用户凭证，生成 JWT Token
- **register()**：注册用户，密码 bcrypt 加密
- **validateUser()**：验证用户邮箱和密码

---

## 二、知识库模块认证集成

### 2.1 已完成的集成工作

#### ✅ KnowledgeBasesController
```typescript
@Controller('api/v1/knowledge-bases')
@UseGuards(AuthGuard)  // 类级别应用守卫
export class KnowledgeBasesController {
  
  @Post()
  async create(@Body() createDto: CreateKnowledgeBaseDto, @CurrentUser() user: any) {
    const userId = user.sub;  // 从 JWT 获取用户 ID
    // ...
  }
  
  @Get()
  async list(@Query('skip') skip: number, @Query('limit') limit: number, @CurrentUser() user: any) {
    const userId = user.sub;
    // ...
  }
  
  // 所有方法都已集成
}
```

#### ✅ KBFilesController
```typescript
@Controller('api/v1/knowledge-bases/:kbId/files')
@UseGuards(AuthGuard)  // 类级别应用守卫
export class KBFilesController {
  
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Param('kbId') kbId: string,
    @UploadedFile() file: any,
    @CurrentUser() user: any,  // 提取当前用户
  ) {
    const userId = user.sub;
    
    // 权限验证：检查知识库归属权
    const kb = await this.kbRepo.findById(kbId);
    if (!kb) {
      throw new HttpException('知识库不存在', HttpStatus.NOT_FOUND);
    }
    if (kb.userId !== userId) {
      throw new HttpException('无权访问该知识库', HttpStatus.FORBIDDEN);
    }
    // ...
  }
  
  // 所有 8 个方法都已集成
}
```

#### ✅ KBSearchController
```typescript
@Controller('api/v1/knowledge-bases/:kbId/search')
@UseGuards(AuthGuard)
export class KBSearchController {
  
  @Post()
  async search(
    @Param('kbId') kbId: string,
    @Body() searchDto: KnowledgeSearchDto,
    @CurrentUser() user: any,
  ) {
    const userId = user.sub;
    // 权限验证逻辑...
  }
  
  @Get('test')
  async testSearch(
    @Param('kbId') kbId: string,
    @Query('query') query: string,
    @CurrentUser() user: any,
  ) {
    const userId = user.sub;
    // 权限验证逻辑...
  }
}
```

### 2.2 权限验证流程

```
客户端请求
    ↓
携带 Authorization: Bearer <JWT Token>
    ↓
AuthGuard 拦截
    ↓
验证 Token 有效性
    ├─ 无效 → 返回 401 Unauthorized
    └─ 有效 → 解码 payload 到 request.user
    ↓
Controller 方法执行
    ↓
@CurrentUser() 提取 user 对象
    ↓
const userId = user.sub
    ↓
权限校验：kb.userId === userId
    ├─ 不匹配 → 返回 403 Forbidden
    └─ 匹配 → 继续执行业务逻辑
```

---

## 三、API 使用示例

### 3.1 登录获取 Token

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "your_password"
  }'
```

**响应**：
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 3.2 创建知识库（需要认证）

```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "name": "我的知识库",
    "description": "测试知识库",
    "embeddingModelId": "model-123",
    "chunkMaxSize": 1000,
    "chunkOverlapSize": 100
  }'
```

### 3.3 上传文件（需要认证）

```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases/kb-123/files/upload \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -F "file=@document.pdf"
```

### 3.4 搜索知识库（需要认证）

```bash
curl -X POST http://localhost:3000/api/v1/knowledge-bases/kb-123/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "query": "人工智能的发展",
    "topK": 5,
    "useHybridSearch": true
  }'
```

### 3.5 错误响应示例

#### 未提供 Token（401）
```json
{
  "statusCode": 401,
  "message": "Missing authentication token"
}
```

#### Token 无效（401）
```json
{
  "statusCode": 401,
  "message": "Invalid token"
}
```

#### 无权访问（403）
```json
{
  "statusCode": 403,
  "message": "无权访问该知识库"
}
```

---

## 四、前端集成建议

### 4.1 Axios 拦截器配置

```typescript
// src/utils/api.ts
import axios from 'axios';

const apiClient = axios.create({
  baseURL: 'http://localhost:3000',
});

// 请求拦截器：自动添加 Token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：处理 401 错误
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token 过期或无效，跳转到登录页
      localStorage.removeItem('access_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

### 4.2 登录流程

```typescript
// src/views/Login.vue
import { ref } from 'vue';
import apiClient from '@/utils/api';

const login = async () => {
  try {
    const response = await apiClient.post('/auth/login', {
      email: email.value,
      password: password.value,
    });
    
    // 保存 Token
    localStorage.setItem('access_token', response.data.access_token);
    
    // 跳转到首页
    router.push('/');
  } catch (error) {
    console.error('登录失败', error);
    alert('邮箱或密码错误');
  }
};
```

### 4.3 知识库 API 调用

```typescript
// src/services/knowledgeBase.ts
import apiClient from '@/utils/api';

export const knowledgeBaseApi = {
  // 创建知识库
  create(data: any) {
    return apiClient.post('/api/v1/knowledge-bases', data);
  },
  
  // 查询列表
  list(skip = 0, limit = 20) {
    return apiClient.get('/api/v1/knowledge-bases', {
      params: { skip, limit },
    });
  },
  
  // 上传文件
  uploadFile(kbId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post(`/api/v1/knowledge-bases/${kbId}/files/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  
  // 查询文件状态
  getFileStatus(kbId: string, fileId: string) {
    return apiClient.get(`/api/v1/knowledge-bases/${kbId}/files/${fileId}/status`);
  },
  
  // 搜索
  search(kbId: string, query: string, options?: any) {
    return apiClient.post(`/api/v1/knowledge-bases/${kbId}/search`, {
      query,
      topK: 5,
      useHybridSearch: true,
      ...options,
    });
  },
};
```

---

## 五、安全最佳实践

### 5.1 Token 存储
- ✅ **推荐**：`localStorage` 或 `sessionStorage`
- ⚠️ **注意**：防范 XSS 攻击，确保没有脚本注入漏洞
- ❌ **避免**：Cookie（除非配置了 HttpOnly 和 Secure 标志）

### 5.2 Token 刷新
```typescript
// 检查 Token 是否即将过期
const isTokenExpiringSoon = () => {
  const token = localStorage.getItem('access_token');
  if (!token) return true;
  
  const payload = JSON.parse(atob(token.split('.')[1]));
  const expiryTime = payload.exp * 1000; // 转换为毫秒
  const now = Date.now();
  
  // 如果剩余时间少于 5 分钟，认为即将过期
  return (expiryTime - now) < 5 * 60 * 1000;
};

// 定期刷新 Token
setInterval(() => {
  if (isTokenExpiringSoon()) {
    // 调用刷新接口或重新登录
    refreshAccessToken();
  }
}, 60 * 1000); // 每分钟检查一次
```

### 5.3 环境变量配置

确保 `.env` 文件中配置了强密钥：

```env
# 生成强密钥：openssl rand -hex 32
JWT_SECRET=your-super-secret-key-at-least-32-characters-long
```

---

## 六、常见问题排查

### Q1: 收到 401 Unauthorized 错误

**可能原因**：
1. 未提供 `Authorization` 请求头
2. Token 格式错误（缺少 `Bearer ` 前缀）
3. Token 已过期
4. Token 签名无效

**解决方法**：
```bash
# 检查请求头
curl -v http://localhost:3000/api/v1/knowledge-bases \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Q2: 收到 403 Forbidden 错误

**可能原因**：
- 尝试访问其他用户的知识库

**解决方法**：
- 确保使用正确的账号登录
- 检查知识库的 `userId` 是否与当前用户匹配

### Q3: Token 解码后没有 `sub` 字段

**可能原因**：
- JWT payload 结构不正确

**检查方法**：
```typescript
// 在 AuthGuard 中添加日志
console.log('JWT Payload:', payload);
// 应该输出：{ email: '...', sub: 'user-id', iat: ..., exp: ... }
```

---

## 七、后续优化建议

### 7.1 角色-based 访问控制（RBAC）
```typescript
// 创建角色守卫
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (!requiredRoles) {
      return true;
    }
    
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}

// 使用示例
@UseGuards(AuthGuard, RolesGuard)
@SetMetadata('roles', ['admin'])
@Delete(':id')
async remove(@Param('id') id: string, @CurrentUser() user: any) {
  // 只有 admin 角色可以删除
}
```

### 7.2 速率限制
```typescript
// 安装：npm install @nestjs/throttler
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

### 7.3 审计日志
记录所有敏感操作：
```typescript
// 创建审计日志服务
@Injectable()
export class AuditLogService {
  async log(userId: string, action: string, resource: string, details?: any) {
    // 保存到数据库或日志文件
    console.log(`[AUDIT] User ${userId} performed ${action} on ${resource}`, details);
  }
}

// 在 Controller 中使用
async deleteFile(@Param('kbId') kbId: string, @Param('fileId') fileId: string, @CurrentUser() user: any) {
  await this.auditLogService.log(user.sub, 'DELETE_FILE', `kb:${kbId}/file:${fileId}`);
  // ...
}
```

---

## 八、总结

✅ **已完成**：
1. 在所有知识库 Controller 上应用 `@UseGuards(AuthGuard)`
2. 使用 `@CurrentUser()` 装饰器提取用户信息
3. 从 `user.sub` 获取真实用户 ID
4. 执行知识库归属权验证（`kb.userId === userId`）
5. 统一的错误处理（401/403）

✅ **安全性**：
- JWT Token 验证
- 用户身份提取
- 资源归属权检查
- 详细的错误提示

✅ **可扩展性**：
- 易于添加角色权限控制
- 支持速率限制
- 可集成审计日志

📝 **下一步**：
1. 在其他模块（Models, Characters, Sessions 等）中应用相同的认证模式
2. 实现 Token 刷新机制
3. 添加速率限制保护
4. 编写单元测试验证认证逻辑
