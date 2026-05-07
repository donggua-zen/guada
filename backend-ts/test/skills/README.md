# Skills 模块测试套件

## 概述

本测试套件全面测试 Skills 集成框架的各个组件，包括单元测试和集成测试。

## 测试结构

```
test/
├── jest-global.d.ts                      # Jest 全局类型声明
├── fixtures/                             # 测试数据
│   └── skills/
│       ├── test-skill-alpha/             # 基础测试 Skill
│       │   └── SKILL.md
│       └── test-skill-beta/              # 带脚本的测试 Skill
│           ├── SKILL.md
│           └── scripts/
│               └── hello.py
└── skills/
    ├── skill-loader.service.spec.ts      # SkillLoaderService 单元测试
    ├── skill-registry.service.spec.ts    # SkillRegistry 单元测试
    ├── skill-script-executor.spec.ts     # SkillScriptExecutor 单元测试
    └── skill-orchestrator.integration.spec.ts  # SkillOrchestrator 集成测试
```

## 测试覆盖范围

### 1. SkillLoaderService (skill-loader.service.spec.ts)

**测试内容**：
- ✅ YAML frontmatter 解析
- ✅ Manifest 字段验证
- ✅ L2 指令惰性加载
- ✅ 内容哈希计算
- ✅ Manifest 重载与变更检测

**关键测试点**：
```typescript
// 测试有效的 SKILL.md 加载
it('应该成功加载有效的 SKILL.md 文件', async () => {
  const skill = await service.loadManifest(skillPath);
  expect(skill.manifest.name).toBe('test-skill-alpha');
  expect(skill.contentHash.length).toBe(64); // SHA256
});

// 测试惰性加载缓存
it('应该缓存已加载的指令', async () => {
  const instructions1 = await service.loadInstructions(skill);
  const instructions2 = await service.loadInstructions(skill);
  expect(instructions1).toBe(instructions2); // 同一引用
});
```

### 2. SkillRegistry (skill-registry.service.spec.ts)

**测试内容**：
- ✅ Skill 注册与更新
- ✅ Skill 注销
- ✅ 按标签搜索
- ✅ 事件监听器（onChange）
- ✅ 取消订阅机制

**关键测试点**：
```typescript
// 测试事件监听
it('应该在注册时触发事件', () => {
  const listener = jest.fn();
  registry.onChange(listener);
  registry.register(skill);
  expect(listener).toHaveBeenCalledWith({ type: 'registered', skill });
});

// 测试标签搜索
it('应该按标签搜索 Skills', () => {
  const results = registry.searchByTags(['alpha']);
  expect(results[0].id).toBe('skill-1');
});
```

### 3. SkillScriptExecutor (skill-script-executor.spec.ts)

**测试内容**：
- ✅ Python 脚本执行
- ✅ 参数传递
- ✅ 超时控制
- ✅ 输出大小限制
- ✅ 错误处理

**关键测试点**：
```typescript
// 测试脚本执行
it('应该成功执行 Python 脚本', async () => {
  const result = await executor.execute(request);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('Hello from test skill beta!');
});

// 测试超时
it('应该在超时时终止执行', async () => {
  const result = await executor.execute(request);
  expect(result.timedOut).toBe(true);
});
```

### 4. SkillOrchestrator (集成测试)

**测试内容**：
- ✅ 文件系统扫描
- ✅ System Prompt 元数据注入
- ✅ 关键词匹配算法
- ✅ Skill 列表与详情查询
- ✅ 热重载功能

**关键测试点**：
```typescript
// 测试扫描功能
it('应该扫描并发现测试目录中的 Skills', async () => {
  const result = await orchestrator.triggerScan();
  expect(result.added.length).toBeGreaterThanOrEqual(2);
  expect(result.added.map(s => s.id)).toContain('test-skill-alpha');
});

// 测试关键词匹配
it('应该根据关键词匹配 Skills', async () => {
  const matches = await orchestrator.matchSkills('alpha testing');
  expect(matches[0].skillId).toBe('test-skill-alpha');
});
```

## 运行测试

### 运行所有 Skills 测试

```bash
npm test -- test/skills
```

### 运行单个测试文件

```bash
npm test -- test/skills/skill-loader.service.spec.ts
```

### 运行特定测试用例

```bash
npm test -- -t "应该成功加载有效的 SKILL.md 文件"
```

### 监视模式（开发时使用）

```bash
npm test -- test/skills --watch
```

### 生成覆盖率报告

```bash
npm test -- test/skills --coverage
```

## 测试配置

### 自定义测试目录

测试使用 `test/fixtures/skills` 作为测试 Skills 目录，通过 ConfigModule 注入：

```typescript
ConfigModule.forRoot({
  load: [() => ({ SKILLS_DIR: testSkillsDir })],
})
```

### 添加新的测试 Skill

在 `test/fixtures/skills/` 下创建新目录：

```bash
mkdir test/fixtures/skills/my-test-skill
cat > test/fixtures/skills/my-test-skill/SKILL.md << EOF
---
name: my-test-skill
description: 测试描述
version: 1.0.0
tags:
  - test
---

# My Test Skill

测试内容...
EOF
```

## 测试最佳实践

### 1. 隔离性

每个测试用例应该独立，不依赖其他测试的执行顺序：

```typescript
beforeEach(async () => {
  // 每个测试前重置状态
  registry = new SkillRegistry();
});
```

### 2. 清理资源

测试后清理临时文件：

```typescript
afterEach(() => {
  if (fs.existsSync(tempFile)) {
    fs.unlinkSync(tempFile);
  }
});
```

### 3. 异步测试超时

为长时间运行的测试设置合适的超时：

```typescript
it('应该在超时时终止执行', async () => {
  // ...
}, 10000); // 10秒超时
```

### 4. Mock 外部依赖

对于网络请求或文件系统操作，使用 Mock：

```typescript
jest.spyOn(fs, 'readFile').mockResolvedValue(mockContent);
```

## 常见问题

### Q: 测试失败提示 "Python not found"

**A**: 确保系统已安装 Python 并添加到 PATH：

```bash
python --version
```

### Q: 测试超时

**A**: 增加测试超时时间或优化测试逻辑：

```typescript
it('long running test', async () => {
  // ...
}, 30000); // 30秒
```

### Q: 文件路径问题

**A**: 使用 `path.join()` 确保跨平台兼容：

```typescript
const skillPath = path.join(__dirname, '../fixtures/skills', 'test-skill');
```

## 扩展测试

### 添加 API 端点测试

创建 `test/skills/skills.controller.spec.ts`：

```typescript
import { Test } from '@nestjs/testing';
import { SkillsController } from '../../src/modules/skills/api/skills.controller';

describe('SkillsController', () => {
  it('GET /api/v1/skills 应该返回 Skills 列表', async () => {
    // ...
  });
});
```

### 添加 E2E 测试

创建 `test/e2e/skills.e2e-spec.ts`：

```typescript
import * as request from 'supertest';

describe('Skills E2E', () => {
  it('/api/v1/skills (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/skills')
      .expect(200)
      .expect(Array);
  });
});
```

## 持续集成

在 CI/CD 流程中添加测试步骤：

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm ci
      - run: npm test -- test/skills --coverage
```

## 参考资源

- [Jest 官方文档](https://jestjs.io/docs/getting-started)
- [NestJS 测试指南](https://docs.nestjs.com/fundamentals/testing)
- [Testing Library](https://testing-library.com/)
