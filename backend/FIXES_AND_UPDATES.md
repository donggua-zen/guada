# 修复和更新日志

## 2026-03-23: MCP 工具调用 JSON 查询修复

### 问题描述

在 `app/services/mcp/tool_manager.py` 中，使用 `has_key` 方法查询 JSON 字段时报错：

```python
# 错误的写法
MCPServer.tools.has_key(original_name)
```

**错误信息：**
```
Error: Neither 'InstrumentedAttribute' object nor 'Comparator' object 
associated with MCPServer.tools has an attribute 'has_key'
```

### 原因分析

SQLAlchemy 的 JSON 类型字段不支持 `has_key` 方法。这是 SQLAlchemy ORM 的限制，不同于直接 SQL 查询中的 `JSON_HAS` 函数。

### 解决方案

使用 SQLAlchemy 的 JSON 下标操作符来检查键是否存在：

```python
# 正确的写法
MCPServer.tools[original_name] != None
```

### 修改内容

**文件：** `app/services/mcp/tool_manager.py`

**修改前：**
```python
stmt = select(MCPServer).filter(
    MCPServer.enabled == True,
    MCPServer.tools.has_key(original_name)  # type: ignore
)
```

**修改后：**
```python
stmt = select(MCPServer).filter(
    MCPServer.enabled == True,
    MCPServer.tools[original_name] != None  # type: ignore
)
```

### 技术说明

SQLAlchemy 提供了多种 JSON 字段操作方式：

1. **下标访问（推荐）**
   ```python
   # 检查键是否存在
   Model.json_field['key'] != None
   
   # 获取特定值
   value = Model.json_field['key']
   ```

2. **路径访问（嵌套 JSON）**
   ```python
   # 访问嵌套键
   Model.json_field['level1']['level2'] != None
   ```

3. **使用 astext 转换**
   ```python
   # 将 JSON 值转换为文本比较
   Model.json_field['key'].astext == 'value'
   ```

### 测试验证

修复后，MCP 工具调用功能正常工作：
- ✅ 能够正确查找包含指定工具的服务器
- ✅ 工具调用流程畅通
- ✅ 无语法错误或运行时异常

### 最佳实践

在处理 SQLAlchemy JSON 字段时：
- ✅ 使用 `field['key']` 进行键访问
- ✅ 使用 `!= None` 检查键是否存在
- ✅ 使用 `.astext` 进行字符串比较
- ❌ 避免使用不存在的 `has_key` 方法
- ❌ 避免直接使用 SQL 特定的 JSON 函数（除非使用 raw SQL）

---

## 相关资源

- [SQLAlchemy JSON 类型文档](https://docs.sqlalchemy.org/en/20/core/type_basics.html#sqlalchemy.types.JSON)
- [PostgreSQL JSON 操作](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#json-operators-and-functions)