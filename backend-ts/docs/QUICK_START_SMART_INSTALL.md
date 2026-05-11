# 智能技能安装 - 快速使用指南

## 🚀 新功能概览

本次更新为 Skills 模块带来了四大智能安装特性：

1. **两级目录智能识别** - 自动找到 SKILL.md，无需手动调整结构
2. **自动层级转换** - 统一转换为标准格式
3. **强制覆盖安装** - 支持覆盖已存在的技能
4. **严格的名称验证** - 防止安全问题和不规范命名

---

## 📦 打包你的 Skill

### 推荐结构（两种都支持）

#### 方式 1：SKILL.md 在根目录
```
my-skill.zip/
├── SKILL.md          ← 系统会找到这个
├── README.md
├── scripts/
│   └── helper.js
└── assets/
    └── icon.png
```

#### 方式 2：SKILL.md 在一级子目录
```
my-skill-package.zip/
├── my-skill/         ← 系统会找到这个目录
│   ├── SKILL.md
│   ├── README.md
│   └── scripts/
└── LICENSE
```

### ❌ 不支持的结构
```
deep-nested.zip/
└── level1/
    └── level2/       ← 不会查找这么深
        └── my-skill/
            └── SKILL.md
```

---

## 💻 使用方法

### 方法 1：通过前端界面（推荐）

1. 点击 **"安装"** 按钮
2. 上传 ZIP 文件
3. （可选）勾选 **"强制覆盖"** 如果技能已存在
4. 点击 **"安装"**

![安装界面](../images/skill-install-ui.png)

### 方法 2：通过 API

#### 普通安装
```javascript
const formData = new FormData();
formData.append('file', zipFile);

const response = await fetch('/api/skills/install', {
  method: 'POST',
  body: formData,
});

const result = await response.json();
console.log(result.message); // "Skill 'my-skill' installed successfully"
```

#### 强制覆盖安装
```javascript
const formData = new FormData();
formData.append('file', zipFile);
formData.append('force', 'true');  // 添加这行

const response = await fetch('/api/skills/install', {
  method: 'POST',
  body: formData,
});
```

#### Git 仓库安装
```javascript
const response = await fetch('/api/skills/install-from-git', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://github.com/example/my-skill.git',
    branch: 'main',
    force: true  // 可选：强制覆盖
  }),
});
```

### 方法 3：通过 cURL

```bash
# 普通安装
curl -X POST http://localhost:3000/api/skills/install \
  -F "file=@my-skill.zip"

# 强制覆盖
curl -X POST http://localhost:3000/api/skills/install \
  -F "file=@my-skill.zip" \
  -F "force=true"

# Git 安装
curl -X POST http://localhost:3000/api/skills/install-from-git \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/example/skill.git",
    "force": true
  }'
```

---

## ✅ 合法的 Skill 名称

### 允许的字符
- 字母：`a-z`, `A-Z`
- 数字：`0-9`
- 连字符：`-`
- 下划线：`_`

### 示例

✅ **合法名称**
```
my-skill
skill_2024
awesome-tool
CodeReview
my-awesome-skill-v2
a
```

❌ **非法名称**
```
skill.name      ← 包含点号
my/skill        ← 包含斜杠
.skill          ← 以特殊字符开头
skill.          ← 以特殊字符结尾
very-long-name-that-exceeds-the-maximum-length-limit-of-fifty-characters  ← 超过50字符
```

---

## 🔍 错误处理

### 常见错误及解决方案

#### 1. 未找到 SKILL.md
```
Error: No SKILL.md found in the ZIP file (searched up to 2 levels deep)
```
**解决方案**：
- 确保 ZIP 中包含 SKILL.md 文件
- SKILL.md 必须在根目录或一级子目录中
- 检查文件名是否完全匹配（区分大小写）

#### 2. 技能名称不合法
```
Error: Skill name contains invalid characters. Only letters, numbers, hyphens, and underscores are allowed. Got: "my.skill"
```
**解决方案**：
- 重命名技能目录，移除特殊字符
- 只使用字母、数字、连字符和下划线

#### 3. 技能已存在
```
Error: Skill 'my-skill' already exists. Use force=true to overwrite.
```
**解决方案**：
- 先卸载旧版本：`POST /api/skills/{skill-id}/uninstall`
- 或使用强制覆盖：添加 `force=true` 参数

#### 4. 名称过长
```
Error: Skill name is too long (max 50 characters). Got: 65 characters
```
**解决方案**：
- 缩短技能名称到 50 个字符以内

---

## 🎯 最佳实践

### 1. 命名规范
```typescript
// ✅ 推荐：小写 + 连字符
my-code-reviewer
data-analyzer
text-formatter

// ✅ 也可接受：下划线
my_code_reviewer

// ❌ 避免：混合大小写和特殊字符
My.Code.Reviewer!
```

### 2. 目录结构
```
skill-name/
├── SKILL.md              ← 必需：技能定义
├── README.md             ← 推荐：详细说明
├── package.json          ← 可选：依赖管理
├── scripts/              ← 可选：辅助脚本
│   ├── helper.js
│   └── utils.py
└── assets/               ← 可选：资源文件
    ├── icon.png
    └── templates/
```

### 3. SKILL.md 内容
```markdown
---
name: my-skill
description: 我的技能描述
version: 1.0.0
author: Your Name
---

# My Skill

## Instructions

详细的使用说明...
```

### 4. 版本管理
- 使用语义化版本号（1.0.0, 1.1.0, 2.0.0）
- 在 SKILL.md 的 frontmatter 中声明版本
- 重大更新时增加主版本号

### 5. 测试后再发布
```bash
# 本地测试
1. 将技能放入 backend-ts/skills/ 目录
2. 点击"刷新"按钮扫描
3. 测试功能是否正常
4. 确认无误后打包为 ZIP
```

---

## 🔄 更新已有 Skill

### 方法 1：强制覆盖（推荐）
```javascript
// 前端：勾选"强制覆盖"复选框
// 后端：force=true
await apiService.installSkill(newZipFile, true);
```

### 方法 2：先卸载再安装
```javascript
// 1. 卸载旧版本
await apiService.uninstallSkill('my-skill');

// 2. 安装新版本
await apiService.installSkill(newZipFile, false);
```

### 方法 3：Git 更新
```javascript
// 如果技能是从 Git 安装的
await fetch(`/api/skills/${skillId}/update`, {
  method: 'POST'
});
```

---

## 🛡️ 安全提示

1. **不要信任未知来源的 Skill**
   - 检查 SKILL.md 内容
   - 审查代码逻辑
   - 注意权限要求

2. **定期备份**
   - 重要的自定义技能要备份
   - 覆盖前确认是否需要保留旧版本

3. **监控日志**
   - 查看安装日志确认操作成功
   - 注意异常错误信息

---

## 📊 性能说明

- **查找速度**：两级搜索通常在 10ms 内完成
- **安装时间**：取决于 ZIP 大小，一般 < 100ms
- **内存占用**：临时文件会自动清理
- **并发支持**：支持同时安装多个技能

---

## 🆘 常见问题

### Q: 为什么我的 SKILL.md 没被找到？
A: 确保它在根目录或一级子目录中，且文件名完全匹配（区分大小写）。

### Q: 可以安装多个技能到一个 ZIP 吗？
A: 当前版本只支持单个技能。如果有多个 SKILL.md，会使用第一个找到的。

### Q: 强制覆盖会丢失数据吗？
A: 是的，会删除整个旧技能目录。请提前备份重要文件。

### Q: 支持从子目录安装吗？
A: 支持！只要 SKILL.md 在根目录或一级子目录即可。

### Q: 如何批量安装多个技能？
A: 当前需要逐个安装。批量安装功能正在开发中。

---

## 📚 相关文档

- [详细功能说明](./smart-skill-install.md)
- [技术实现总结](./IMPLEMENTATION_SUMMARY.md)
- [Skills 架构设计](../../docs/skills-integration-framework-design.md)

---

## 🎉 开始使用

现在就试试新的智能安装功能吧！

```bash
# 1. 准备你的 Skill ZIP 包
# 2. 打开前端界面
# 3. 点击"安装"按钮
# 4. 上传文件
# 5. 享受自动化带来的便利！
```

有任何问题或建议，欢迎反馈！🚀
