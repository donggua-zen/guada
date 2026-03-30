# Pydantic Schema 完整格式 - OpenAI Function Calling

## 📋 概述

说明如何使用 `to_openai_function_format()` 方法将 Pydantic 生成的参数 Schema 转换为完整的 OpenAI Function Calling 格式。

---

## ✅ 完整的 OpenAI Function Calling 格式

OpenAI API 需要的完整格式包含**三层结构**：

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "获取指定城市的当前天气",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "城市和国家，如：Beijing, China"
        },
        "unit": {
          "type": "string",
          "enum": ["celsius", "fahrenheit"],
          "description": "温度单位"
        }
      },
      "required": ["location"],
      "additionalProperties": false
    }
  }
}
```

**三层结构**：
1. **外层包装**：`{"type": "function", ...}`
2. **函数定义**：`{"name": "...", "description": "...", "parameters": {...}}`
3. **参数 Schema**：Pydantic 生成的部分（`parameters` 的内容）

---

## ✅ 使用方法

### **Step 1: Pydantic 生成参数 Schema**

```python
from pydantic import BaseModel, Field
from typing import Literal, Optional

class GetWeatherParams(BaseModel):
    location: str = Field(..., description="城市和国家，如：Beijing, China")
    unit: Optional[Literal["celsius", "fahrenheit"]] = Field(
        default="celsius",
        description="温度单位"
    )

# 生成参数 Schema（只有 parameters 的内容）
schema = model_class.model_json_schema()
# 结果：
# {
#   "type": "object",
#   "properties": {...},
#   "required": ["location"],
#   "description": "获取指定城市的当前天气"
# }
```

---

### **Step 2: 转换为 OpenAI 格式**

使用 `to_openai_function_format()` 方法进行包装：

```python
from app.services.tools.providers.memory_tool_provider import MemoryToolProvider

provider = MemoryToolProvider(session)

# Step 1: 获取参数 Schema
schemas = await provider._get_tools_internal()
# schemas['add_memory'] = {
#     "type": "object",
#     "properties": {...},
#     "required": ["content"],
#     "description": "添加新的长期记忆"
# }

# Step 2: 转换为 OpenAI 格式
openai_format = provider.to_openai_function_format(
    tool_name="add_memory",
    schema=schemas['add_memory']
)

# 结果：
# {
#   "type": "function",
#   "function": {
#     "name": "add_memory",
#     "description": "添加新的长期记忆",
#     "parameters": {
#       "type": "object",
#       "properties": {...},
#       "required": ["content"],
#       "description": "添加新的长期记忆"
#     }
#   }
# }
```

---

## ✅ 在 AgentService 中使用

### **场景：调用 LLM 时传递工具列表**

```python
async def completions(self, session_id: str, message_id: str, ...):
    """生成流式响应"""
    
    # 1. 获取所有工具的参数 Schema
    all_tools = await self.tool_orchestrator.get_all_tools(tool_context)
    
    # 2. 转换为 OpenAI Function Calling 格式
    tools_for_llm = []
    for tool_name, tool_schema in all_tools.items():
        # 找到对应的 Provider
        provider = await self.tool_orchestrator.find_provider_for_tool(tool_name)
        
        if provider and hasattr(provider, 'to_openai_function_format'):
            openai_format = provider.to_openai_function_format(
                tool_name=tool_name.replace(f"{provider.namespace}__", ""),
                schema=tool_schema
            )
            tools_for_llm.append(openai_format)
    
    # 3. 调用 LLM（传入完整的工具格式）
    llm_service = LLMService(provider.api_url, provider.api_key)
    response = await llm_service.chat(
        messages=messages,
        tools=tools_for_llm  # ← 完整的 OpenAI 格式
    )
```

---

## 📊 格式对比

### **内部 Schema（parameters 内容）**

```json
{
  "type": "object",
  "properties": {
    "content": {
      "description": "要记住的内容",
      "type": "string"
    },
    "memory_type": {
      "default": "general",
      "description": "记忆类型...",
      "enum": ["general", "emotional", "factual"],
      "type": "string"
    }
  },
  "required": ["content"],
  "description": "添加新的长期记忆"
}
```

**用途**：描述工具的参数结构  
**位置**：`parameters` 字段的内容

---

### **OpenAI 完整格式**

```json
{
  "type": "function",
  "function": {
    "name": "add_memory",
    "description": "添加新的长期记忆",
    "parameters": {
      // ← 这里是上面的内部 Schema
      "type": "object",
      "properties": {...},
      "required": ["content"],
      "description": "添加新的长期记忆"
    }
  }
}
```

**用途**：传递给 OpenAI API 的完整工具定义  
**位置**：LLM 调用的 `tools` 参数

---

## ⚠️ 常见错误

### **错误 1: 直接使用内部 Schema**

```python
# ❌ 错误：缺少外层包装
tools = [
    {
        "type": "object",  # ← 应该是 "type": "function"
        "properties": {...},
        "required": ["content"]
    }
]

response = await llm_service.chat(messages, tools=tools)
# OpenAI API 会报错：Invalid tool format
```

---

### **错误 2: 忘记 function 包装层**

```python
# ❌ 错误：缺少 function 包装层
tools = [
    {
        "type": "function",
        "name": "add_memory",  # ← name 应该在内层
        "description": "...",
        "parameters": {...}
    }
]

# ✅ 正确
tools = [
    {
        "type": "function",
        "function": {  # ← 必须有 function 包装层
            "name": "add_memory",
            "description": "...",
            "parameters": {...}
        }
    }
]
```

---

### **错误 3: 命名空间处理错误**

```python
# ❌ 错误：工具名包含命名空间前缀
openai_format = provider.to_openai_function_format(
    tool_name="memory__add_memory",  # ← 不应该有前缀
    schema=schema
)

# 结果：
# {
#   "function": {
#     "name": "memory__add_memory",  // ← OpenAI 不想要前缀
#     ...
#   }
# }

# ✅ 正确
openai_format = provider.to_openai_function_format(
    tool_name="add_memory",  # ← 去掉前缀
    schema=schema
)
```

---

## ✅ 最佳实践

### **1. 在 ToolOrchestrator 中自动转换**

可以在 `ToolOrchestrator` 中添加一个方法，自动完成所有转换：

```python
class ToolOrchestrator:
    async def get_all_tools_for_openai(
        self, 
        context: Optional[ToolExecutionContext] = None
    ) -> List[Dict[str, Any]]:
        """获取所有工具的 OpenAI 格式
        
        Returns:
            List[Dict]: 完整的 OpenAI Function Calling 格式列表
        """
        all_tools = await self.get_all_tools(context)
        openai_tools = []
        
        for tool_name, tool_schema in all_tools.items():
            # 提取命名空间和纯工具名
            if "__" in tool_name:
                namespace, pure_name = tool_name.split("__", 1)
            else:
                namespace, pure_name = None, tool_name
            
            # 找到 Provider
            provider = await self.find_provider_for_tool(tool_name)
            
            if provider and hasattr(provider, 'to_openai_function_format'):
                openai_format = provider.to_openai_function_format(
                    tool_name=pure_name,
                    schema=tool_schema
                )
                openai_tools.append(openai_format)
        
        return openai_tools
```

**使用**：
```python
# 一行代码获取完整的 OpenAI 工具列表
tools = await orchestrator.get_all_tools_for_openai(context)

# 直接传给 LLM
response = await llm_service.chat(messages, tools=tools)
```

---

### **2. 在 agent_service.py 中的实际应用**

```python
# 从 ToolOrchestrator 获取工具
all_tools = await self.tool_orchestrator.get_all_tools(tool_context)

# 转换为 OpenAI 格式
all_tools_schema = []
for tool_name, tool_data in all_tools.items():
    # 去掉命名空间前缀
    if "__" in tool_name:
        pure_name = tool_name.split("__")[1]
    else:
        pure_name = tool_name
    
    # 查找 Provider 并转换格式
    provider = await self.tool_orchestrator.find_provider_for_tool(tool_name)
    if provider and hasattr(provider, 'to_openai_function_format'):
        openai_format = provider.to_openai_function_format(pure_name, tool_data)
        all_tools_schema.append(openai_format)

# 调用 LLM
llm_response = await llm_service.chat(messages, tools=all_tools_schema)
```

---

## 🎯 完整示例

### **从定义到使用的完整流程**

```python
# Step 1: 定义 Pydantic 模型
class AddMemoryParams(BaseModel):
    content: str = Field(..., description="要记住的内容")
    memory_type: Literal["general", "emotional", "factual"] = Field(
        default="general",
        description="记忆类型"
    )
    importance: int = Field(
        default=5,
        ge=1,
        le=10,
        description="重要性评分"
    )

# Step 2: 在 Provider 中实现
class MemoryToolProvider(IToolProvider):
    async def _get_tools_internal(self) -> Dict[str, Dict[str, Any]]:
        return {
            "add_memory": self._generate_schema(AddMemoryParams, "添加新的长期记忆")
        }
    
    def to_openai_function_format(self, tool_name: str, schema: Dict[str, Any]):
        return {
            "type": "function",
            "function": {
                "name": tool_name,
                "description": schema.get("description"),
                "parameters": schema
            }
        }

# Step 3: 获取并转换
provider = MemoryToolProvider(session)
schemas = await provider._get_tools_internal()
openai_format = provider.to_openai_function_format("add_memory", schemas["add_memory"])

# Step 4: 传递给 LLM
tools = [openai_format]
response = await llm_service.chat(messages, tools=tools)

# Step 5: LLM 返回工具调用
tool_calls = response.choices[0].message.tool_calls
# [
#   {
#     "id": "call_123",
#     "type": "function",
#     "function": {
#       "name": "add_memory",
#       "arguments": "{\"content\": \"...\", \"importance\": 8}"
#     }
#   }
# ]
```

---

## 📈 总结

| 格式 | 内容 | 用途 |
|------|------|------|
| **内部 Schema** | `{"type": "object", "properties": {...}}` | 描述参数结构 |
| **OpenAI 完整格式** | `{"type": "function", "function": {"name": "...", "parameters": {...}}}` | 传递给 OpenAI API |

**关键点**：
- ✅ **三层结构**：`type` → `function` → `parameters`
- ✅ **使用辅助方法**：`to_openai_function_format()`
- ✅ **去掉命名空间**：工具名不应包含前缀
- ✅ **自动化转换**：可以在 Orchestrator 层统一处理

这样就完整了！🚀
