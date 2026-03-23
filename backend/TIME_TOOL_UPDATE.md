# 工具库更新 - 获取当前时间

## 📋 概述

已将示例工具替换为实用的**获取当前时间工具**，使 AI 助手能够提供准确的时间信息。

---

## ✅ 变更内容

### 移除的工具
- ❌ `get_current_weather` - 天气查询（示例）
- ❌ `get_stock_price` - 股票价格查询（示例）

### 新增的工具
- ✅ `get_current_time` - 获取当前系统时间（实用）

---

## 🔧 工具详情

### get_current_time

**功能描述：** 获取当前系统时间，支持自定义格式化

**参数：**
- `format` (string, 可选): 时间格式字符串
  - 默认值：`"YYYY-MM-DD HH:mm:ss"`
  - 支持的占位符：
    - `YYYY` - 四位年份
    - `MM` - 两位月份
    - `DD` - 两位日期
    - `HH` - 24 小时制小时
    - `mm` - 两位分钟
    - `ss` - 两位秒

**返回值：**
```json
{
  "current_time": "2026-03-23 10:06:55",
  "timezone": "local",
  "timestamp": 1774231615
}
```

**Tool Schema:**
```json
{
  "type": "function",
  "function": {
    "name": "get_current_time",
    "description": "获取当前系统时间",
    "parameters": {
      "type": "object",
      "properties": {
        "format": {
          "type": "string",
          "description": "时间格式，支持 YYYY-MM-DD、HH:mm:ss 等格式"
        }
      },
      "required": []
    }
  }
}
```

---

## 🎯 使用示例

### 示例 1: 默认格式

**用户提问：**
> 现在几点了？

**LLM 调用：**
```json
{
  "name": "get_current_time",
  "arguments": {}
}
```

**返回结果：**
```json
{
  "current_time": "2026-03-23 10:06:55",
  "timezone": "local",
  "timestamp": 1774231615
}
```

### 示例 2: 指定日期格式

**用户提问：**
> 今天的日期是什么？

**LLM 调用：**
```json
{
  "name": "get_current_time",
  "arguments": {"format": "YYYY-MM-DD"}
}
```

**返回结果：**
```json
{
  "current_time": "2026-03-23",
  "timezone": "local",
  "timestamp": 1774231615
}
```

### 示例 3: 自定义格式

**用户提问：**
> 现在是什么时间，用斜杠分隔

**LLM 调用：**
```json
{
  "name": "get_current_time",
  "arguments": {"format": "YYYY/MM/DD HH:mm"}
}
```

**返回结果：**
```json
{
  "current_time": "2026/03/23 10:06",
  "timezone": "local",
  "timestamp": 1774231615
}
```

---

## 📊 测试结果

### 测试 1: 基本功能
```
✓ Result: {'current_time': '2026-03-23 10:06:55', 'timezone': 'local', 'timestamp': 1774231615}
```

### 测试 2: 工具 Schema
```
✓ Tools count: 1
Tool Schema:
{
  "type": "function",
  "function": {
    "name": "get_current_time",
    "description": "获取当前系统时间",
    "parameters": {...}
  }
}
```

### 测试 3: 多种格式
```
Format 'YYYY-MM-DD': 2026-03-23
Format 'HH:mm:ss': 10:06:55
Format 'YYYY/MM/DD HH:mm': 2026/03/23 10:06
Format 'DD-MM-YYYY': 23-03-2026
```

**所有测试通过！** ✅

---

## 🔄 代码变更

### 修改的文件

**文件：** `app/services/domain/function_calling/utils.py`

**主要变更：**

1. **添加 datetime 导入**
   ```python
   from datetime import datetime
   ```

2. **新增工具函数**
   ```python
   async def get_current_time(format: str = "YYYY-MM-DD HH:mm:ss") -> Dict[str, Any]:
       """获取当前系统时间"""
       now = datetime.now()
       
       # 自定义格式化
       time_str = format.replace("YYYY", str(now.year)) \
                        .replace("MM", f"{now.month:02d}") \
                        .replace("DD", f"{now.day:02d}") \
                        .replace("HH", f"{now.hour:02d}") \
                        .replace("mm", f"{now.minute:02d}") \
                        .replace("ss", f"{now.second:02d}")
       
       return {
           "current_time": time_str,
           "timezone": "local",
           "timestamp": int(now.timestamp())
       }
   ```

3. **更新工具映射**
   ```python
   TOOLS_MAP = {
       "get_current_time": get_current_time,
   }
   
   def get_tools_schema():
       return [
           function_schema(get_current_time),
       ]
   ```

---

## 🎨 实际应用场景

### 场景 1: 日常对话

**用户：** "早上好！现在几点了？"

**AI 助手：** 
1. 调用 `get_current_time()` 工具
2. 获取当前时间："现在是上午 10:06"
3. 回复："早上好！现在是上午 10:06，祝您有美好的一天！"

### 场景 2: 时间计算

**用户：** "距离明天还有多少小时？"

**AI 助手：**
1. 调用 `get_current_time()` 获取当前时间
2. 计算到明天的时间差
3. 回复："距离明天还有大约 14 小时"

### 场景 3: 会议安排

**用户：** "帮我记录一下，下午 3 点开会"

**AI 助手：**
1. 调用 `get_current_time()` 确认当前时间
2. 解析"下午 3 点"的具体时间
3. 创建日程提醒

### 场景 4: 跨时区对话

**用户：** "北京时间现在几点？"

**AI 助手：**
1. 调用 `get_current_time()` 获取本地时间
2. 如果服务器在北京，直接返回
3. 如果需要转换，进行时区换算

---

## 💡 优势

### 1. **实用性**
- ✅ 真实可用的工具，而非演示示例
- ✅ 满足日常对话中的时间查询需求
- ✅ 支持灵活的时间格式

### 2. **准确性**
- ✅ 直接从系统获取时间，保证准确
- ✅ 包含 Unix 时间戳，便于程序处理
- ✅ 标注时区信息，避免歧义

### 3. **灵活性**
- ✅ 支持多种时间格式
- ✅ 可自定义输出样式
- ✅ 适应不同地区的使用习惯

### 4. **易用性**
- ✅ 参数可选，默认格式即可用
- ✅ 返回值结构清晰
- ✅ 易于 LLM 理解和使用

---

## 🔗 集成说明

### 与 MCP 工具配合

当前系统同时支持：
- **本地工具**：`get_current_time`
- **MCP 工具**：`mcp__bailian_web_search`（阿里云搜索）

**工具列表：**
```python
[
  {
    "name": "get_current_time",  # 本地工具
    "description": "获取当前系统时间"
  },
  {
    "name": "mcp__bailian_web_search",  # MCP 工具
    "description": "联网搜索"
  }
]
```

LLM 会根据问题自动选择合适的工具：
- 问时间 → `get_current_time`
- 查信息 → `mcp__bailian_web_search`

---

## 📝 注意事项

### 1. 时区问题

当前工具返回的是**服务器本地时间**。如果需要支持其他时区：

```python
from datetime import datetime, timezone

async def get_current_time(format: str = "YYYY-MM-DD HH:mm:ss", timezone: str = "UTC"):
    if timezone == "UTC":
        now = datetime.now(timezone.utc)
    else:
        # 使用时区转换
        now = datetime.now()
    
    # ... 格式化逻辑
```

### 2. 格式验证

建议在生产环境中添加格式验证：

```python
import re

def validate_format(fmt: str) -> bool:
    valid_patterns = ["YYYY", "MM", "DD", "HH", "mm", "ss"]
    return any(p in fmt for p in valid_patterns)
```

### 3. 性能考虑

该工具是纯内存操作，性能极佳：
- ⚡ 执行时间：< 1ms
- 💾 内存占用：忽略不计
- 🔄 无外部依赖

---

## 🎉 总结

通过将示例工具替换为实用的**获取当前时间工具**：

✅ **提升实用性** - 从演示变为真实可用的功能  
✅ **增强用户体验** - AI 能够回答时间相关问题  
✅ **保持简洁** - 单一职责，易于维护  
✅ **灵活扩展** - 支持自定义格式，适应多场景  

立即体验这个实用的小工具吧！⏰