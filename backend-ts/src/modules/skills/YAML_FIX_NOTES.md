# Skills YAML 解析错误修复

## 问题现象

启动后端服务时，日志显示：

```
[SkillDiscoveryService] Scan completed: +0 ~0 -0 (errors: 1)
```

表示扫描过程中遇到了 1 个错误，但没有显示具体错误信息。

## 根本原因

### 1. 错误日志不详细

`SkillDiscoveryService` 在扫描完成后只记录了错误数量，没有输出具体的错误信息，导致无法定位问题。

### 2. YAML 解析器缺陷

自定义的简单 YAML 解析器（`parseSimpleYaml`）在处理多行字符串（使用 `>` 符号）时存在逻辑缺陷：

**原始代码问题**：
```typescript
if (value === '>' || value === '|') {
  // 简单处理：将后续行合并为单行
  result[currentKey] = '';  // ❌ 设置为空字符串
}
// ...
currentKey = null;  // ❌ 立即清空 currentKey，导致后续行无法关联
```

当解析以下 YAML 时：
```yaml
description: >
  示例 Skill，用于演示 Skills 框架的基本功能。
  包含简单的文本处理工具和最佳实践指南。
```

解析器会：
1. 遇到 `description: >`，将 `result['description']` 设为空字符串
2. 立即将 `currentKey` 设为 `null`
3. 后续的多行内容无法关联到 `description` 字段
4. 导致解析失败或数据丢失

## 解决方案

### 修复 1：增强错误日志

在 `skill-discovery.service.ts` 中添加详细的错误日志输出：

```typescript
// 记录详细错误信息
if (result.errors.length > 0) {
  this.logger.warn(`Scan encountered ${result.errors.length} error(s):`);
  result.errors.forEach((err, index) => {
    this.logger.warn(`  Error ${index + 1}: [${err.path || 'unknown'}] ${err.error}`);
  });
}
```

**效果**：现在可以看到每个错误的详细信息，包括文件路径和错误消息。

### 修复 2：改进 YAML 解析器

重写 `parseSimpleYaml` 方法，添加多行字符串状态跟踪：

```typescript
private parseSimpleYaml(yamlContent: string): SkillManifest {
  const result: any = {};
  const lines = yamlContent.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] = [];
  let isMultiline = false;  // ✅ 新增：多行字符串状态标记

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // ✅ 跳过空行（但在多行字符串中保留）
    if (!trimmedLine && !isMultiline) continue;

    // ✅ 检查是否是数组项（仅在非多行模式下）
    if (trimmedLine.startsWith('- ') && !isMultiline) {
      if (currentKey) {
        currentArray.push(trimmedLine.substring(2).trim());
      }
      continue;
    }

    // ✅ 保存之前的数组（仅在非多行模式下）
    if (currentKey && currentArray.length > 0 && !isMultiline) {
      result[currentKey] = currentArray;
      currentArray = [];
    }

    // 检查是否是键值对
    const kvMatch = trimmedLine.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      // ✅ 保存之前的多行字符串状态
      if (isMultiline && currentKey) {
        isMultiline = false;
      }
      
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value) {
        // ✅ 处理多行字符串（以 > 或 | 开头）
        if (value === '>' || value === '|') {
          isMultiline = true;  // ✅ 设置多行模式
          result[currentKey] = '';
        } else {
          result[currentKey] = value.replace(/^['"]|['"]$/g, '');
          isMultiline = false;
        }
      }
    } else if (currentKey && trimmedLine) {
      // ✅ 多行字符串的延续
      if (isMultiline) {
        if (result[currentKey]) {
          result[currentKey] += ' ' + trimmedLine;  // ✅ 追加内容
        } else {
          result[currentKey] = trimmedLine;
        }
      }
    }
  }
  
  // 保存最后一个数组
  if (currentKey && currentArray.length > 0) {
    result[currentKey] = currentArray;
  }

  return result as SkillManifest;
}
```

**关键改进**：
1. ✅ 添加 `isMultiline` 状态标记
2. ✅ 在多行模式下不清空 `currentKey`
3. ✅ 正确追加多行字符串内容
4. ✅ 区分数组项和多行字符串续行

## 测试验证

### 运行单元测试

```bash
npm test -- test/skills/skill-loader-yaml-fix.spec.ts
```

测试覆盖：
- ✅ 多行字符串解析（`>` 符号）
- ✅ 数组解析
- ✅ 引号字符串解析
- ✅ 混合内容解析
- ✅ 真实文件加载测试

### 重启后端服务

```bash
npm run start:dev
```

**预期日志**：
```
[Nest] [SkillDiscoveryService] Scan completed: +1 ~0 -0 (errors: 0)
```

如果仍有错误，现在会显示详细信息：
```
[Nest] [SkillDiscoveryService] Scan encountered 1 error(s):
[Nest] [SkillDiscoveryService]   Error 1: [skills/problem-skill] Invalid SKILL.md format: missing YAML frontmatter
[Nest] [SkillDiscoveryService] Scan completed: +0 ~0 -0 (errors: 1)
```

## 相关文件

- `src/modules/skills/core/skill-loader.service.ts` - YAML 解析器（已修复）
- `src/modules/skills/core/skill-discovery.service.ts` - 错误日志增强（已修复）
- `test/skills/skill-loader-yaml-fix.spec.ts` - YAML 解析测试（新增）
- `skills/example-skill/SKILL.md` - 示例 Skill（包含多行描述）

## 后续优化建议

### P0（已完成）
- ✅ 修复 YAML 多行字符串解析
- ✅ 增强错误日志输出

### P1（建议）
- [ ] 使用成熟的 YAML 库（如 `js-yaml`）替代自定义解析器
- [ ] 添加更严格的 YAML 格式验证
- [ ] 支持更多 YAML 特性（嵌套对象、锚点等）

### P2（可选）
- [ ] 实现 YAML schema 验证
- [ ] 提供友好的错误提示（行号、列号）
- [ ] 支持 YAML 注释保留

## 技术细节

### YAML 多行字符串语法

```yaml
# 折叠样式（>）：换行符转换为空格
description: >
  This is a long
  description that will
  be folded into one line.

# 字面样式（|）：保留换行符
content: |
  Line 1
  Line 2
  Line 3
```

### 解析流程

```
输入 YAML
  ↓
分割为行
  ↓
逐行处理
  ├─ 键值对 → 设置 currentKey
  ├─ 数组项 → 添加到 currentArray
  └─ 续行   → 根据 isMultiline 决定行为
       ├─ isMultiline=true  → 追加到当前键的值
       └─ isMultiline=false → 忽略或报错
  ↓
返回解析结果
```

---

**修复时间**: 2026-05-04  
**影响范围**: YAML 解析逻辑  
**向后兼容**: ✅ 是（仅改进了多行字符串处理）  
**测试覆盖**: 5 个新测试用例
