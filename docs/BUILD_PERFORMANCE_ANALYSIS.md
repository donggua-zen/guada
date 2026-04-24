# Electron 构建性能分析报告

## 优化实施记录

### 2026-04-23 第一次优化

**实施的优化**:
1. ✅ 移除 @prisma/studio-core (37.44 MB)
2. ✅ 移除 @prisma/dev (14.29 MB)
3. ✅ 移除 wordnet-db (33.77 MB)
4. ✅ 移除 @electric-sql/pglite (22.15 MB)

**优化效果**:
- 优化前: 511.56 MB
- 优化后: 350.25 MB
- 减少: 161.31 MB (**31.5%**)

**实施方法**:
在 `scripts/optimize-electron-deps.js` 中添加了模块移除逻辑，在安装依赖后自动清理不必要的模块。

## 构建体积分析

### 总体积分布

| 组件 | 体积 | 占比 | 说明 |
|------|------|------|------|
| **node_modules** | **511.39 MB** | **82.6%** | 后端依赖（最大部分） |
| dist (编译代码) | 92.03 MB | 14.9% | NestJS 编译输出 |
| app.asar (前端) | 2.34 MB | 0.4% | Vue 前端应用 |
| static (静态资源) | 0.60 MB | 0.1% | 图片等静态文件 |
| **总计** | **~606 MB** | **100%** | unpacked 目录 |

### Top 10 最大模块

| 排名 | 模块 | 体积 | 占比 | 类别 | 可优化 |
|------|------|------|------|------|--------|
| 1 | @prisma/client | 71.55 MB | 14.0% | 数据库 ORM | ❌ 必需 |
| 2 | better-sqlite3 | 69.56 MB | 13.6% | 原生模块 | ❌ 必需 |
| 3 | prisma | 39.99 MB | 7.8% | CLI 工具 | ⚠️ 部分可优化 |
| 4 | @prisma/studio-core | 37.37 MB | 7.3% | Prisma Studio | ✅ **可移除** |
| 5 | @napi-rs/canvas | 35.04 MB | 6.9% | Canvas 渲染 | ❓ 检查用途 |
| 6 | wordnet-db | 33.76 MB | 6.6% | NLP 词网 | ✅ **可移除** |
| 7 | tiktoken | 22.48 MB | 4.4% | Tokenizer | ❌ 必需 |
| 8 | @prisma/engines | 21.23 MB | 4.2% | Prisma 引擎 | ⚠️ 部分可优化 |
| 9 | @img/sharp-win32 | 18.95 MB | 3.7% | 图片处理 | ❌ 必需 |
| 10 | @electric-sql/pglite | 18.07 MB | 3.5% | PostgreSQL | ❓ 检查用途 |

### 分类统计

| 类别 | 总体积 | 占比 | 说明 |
|------|--------|------|------|
| **Prisma & Database** | **289.98 MB** | **56.7%** | 数据库相关（最大头） |
| AI & NLP | 83.16 MB | 16.3% | AI 和自然语言处理 |
| PDF Processing | 27.51 MB | 5.4% | PDF 处理库 |
| Image Processing | 19.41 MB | 3.8% | 图片处理 |
| Utilities | 2.90 MB | 0.6% | 工具库 |
| NestJS Core | 2.14 MB | 0.4% | 框架核心（很小） |

## 构建速度慢的原因

### 1. **依赖安装耗时 (~50秒)**
```
Step 2: Installing production dependencies only...
added 307 packages in 49s
```
- 需要下载和安装 307 个包
- 包括大型二进制文件（Prisma engines、better-sqlite3 等）

### 2. **Prisma 客户端生成 (~5秒)**
```
✔ Generated Prisma Client (v7.6.0) to .\node_modules\@prisma\client in 326ms
```
- 虽然生成很快，但需要先安装 Prisma CLI

### 3. **文件清理耗时 (~10-20秒)**
```
✓ Cleaned 12571 unnecessary files
```
- 遍历并删除 12,571 个文件
- 涉及大量文件系统操作

### 4. **原生模块重建 (~60-120秒)**
```
Rebuilding for node_modules_electron...
rebuilt dependencies successfully

Rebuilding for node_modules_production...
rebuilt dependencies successfully
```
- 需要为两个目录分别编译
- better-sqlite3、sqlite-vec、@node-rs/jieba 都需要编译
- Windows 下使用 MSBuild 编译较慢

### 5. **前端构建 (~45秒)**
```
✓ built in 44.77s
```
- Vite 构建 Vue 应用
- 包含大量组件和资源

### 6. **Electron 打包 (~60-180秒)**
```
• packaging       platform=win32 arch=x64 electron=41.3.0
• building        target=nsis file=release\AI Chat Setup 1.0.0.exe
```
- 创建 ASAR 归档
- NSIS 安装包压缩和构建
- 这是最耗时的步骤之一

**总构建时间**: 约 **5-8 分钟**

## 优化建议

### 🔴 高优先级（可减少 100MB+）

#### 1. 移除 Prisma Studio 相关模块
**影响**: -37 MB (@prisma/studio-core) + -14 MB (@prisma/dev) = **-51 MB**

Prisma Studio 是开发工具，生产环境不需要。

**方法**: 在 `optimize-electron-deps.js` 中添加清理逻辑：
```javascript
// 移除 Prisma Studio 相关文件
const studioPaths = [
  path.join(optimizedPath, 'node_modules', '@prisma', 'studio-core'),
  path.join(optimizedPath, 'node_modules', '@prisma', 'dev')
]
for (const studioPath of studioPaths) {
  if (fs.existsSync(studioPath)) {
    fs.rmSync(studioPath, { recursive: true, force: true })
    console.log(`✓ Removed ${path.basename(studioPath)}`)
  }
}
```

#### 2. 移除 wordnet-db
**影响**: **-34 MB**

如果不需要 `natural` 库的词网（WordNet）功能，可以移除。

**检查方法**:
```bash
grep -r "wordnet" backend-ts/src/
```

如果没有使用，可以在 package.json 中排除：
```javascript
// 在 optimize-electron-deps.js 中
const wordnetPath = path.join(optimizedPath, 'node_modules', 'wordnet-db')
if (fs.existsSync(wordnetPath)) {
  fs.rmSync(wordnetPath, { recursive: true, force: true })
}
```

#### 3. 优化 Prisma 引擎
**影响**: **-10-15 MB**

Prisma 包含了多个平台的引擎，但生产环境只需要当前平台。

**方法**: 设置环境变量
```bash
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
```

或在安装时指定平台：
```javascript
execSync('npm install --omit=dev --omit=optional --platform win32', {
  cwd: optimizedPath,
  env: { ...process.env, PRISMA_CLI_BINARY_TARGETS: 'windows' }
})
```

### 🟡 中优先级（可减少 20-50MB）

#### 4. 检查 @napi-rs/canvas 用途
**影响**: 可能 **-35 MB**

Canvas 库通常用于图像处理或 PDF 渲染。如果项目中没有直接使用，可能是某个依赖的间接依赖。

**检查**:
```bash
npm why @napi-rs/canvas
```

如果不是必需的，可以添加 resolutions/excludes。

#### 5. 检查 @electric-sql/pglite 用途
**影响**: 可能 **-18 MB**

这是一个嵌入式 PostgreSQL，如果项目只使用 SQLite，这个库可能不需要。

**检查**:
```bash
grep -r "pglite\|@electric-sql" backend-ts/src/
```

#### 6. 替换 pdfjs-dist
**影响**: **-16 MB**

如果只需要提取 PDF 文本，可以使用更轻量的方案：
- `pdf-parse` (已安装，9.95 MB) 已经足够
- 移除 `pdfjs-dist` (15.97 MB)

### 🟢 低优先级（可减少 5-20MB）

#### 7. 压缩 Prisma Client
Prisma Client 包含大量类型定义和文档，可以尝试：
- 移除 `.d.ts` 文件（如果不需要类型检查）
- 压缩 JavaScript 文件

#### 8. 启用 ASAR 压缩
当前配置 `asar: true`，但可以优化压缩级别。

## 预期优化效果

| 优化项 | 减少体积 | 实施难度 | 风险 |
|--------|----------|----------|------|
| 移除 Prisma Studio | ~51 MB | 低 | 低 |
| 移除 wordnet-db | ~34 MB | 低 | 中（需验证） |
| 优化 Prisma 引擎 | ~15 MB | 中 | 低 |
| 移除 pdfjs-dist | ~16 MB | 低 | 中（需验证） |
| 检查 canvas/pglite | ~53 MB | 中 | 中（需验证） |
| **总计** | **~169 MB** | - | - |

**优化后预期体积**: 511 MB → **~342 MB** (减少 **33%**)

## 构建速度优化建议

### 1. 并行化构建
当前流程是串行的，可以考虑：
- 前端构建和后端优化并行
- 原生模块重建并行（已在做）

### 2. 缓存优化
- 缓存 `node_modules_production`（如果依赖未变化）
- 缓存编译后的原生模块

### 3. 增量构建
- 只在依赖变化时重新运行 `optimize:electron-deps`
- 只在源码变化时重新编译

### 4. 使用更快的压缩算法
NSIS 支持不同的压缩算法，LZMA2 比默认更快。

## 立即行动建议

1. **先实施高优先级优化**（移除 Prisma Studio 和 wordnet-db）
   - 预计减少 85 MB
   - 实施简单，风险低

2. **验证中优先级优化**
   - 检查 canvas 和 pglite 是否必需
   - 评估是否可以移除 pdfjs-dist

3. **监控构建时间**
   - 记录每个步骤的耗时
   - 识别瓶颈并针对性优化

4. **考虑长期方案**
   - 评估是否需要替换 Prisma（最大的依赖）
   - 考虑使用更轻量的 ORM（如 Drizzle、Kysely）
