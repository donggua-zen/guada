"""
OpenAI 工具转换工具 - 简化版

提供统一的工具转换方法，支持自动解析函数签名和参数构建
简化规则：
    - Pydantic 模型参数：作为工具参数传递给 OpenAI
    - 普通参数：作为注入参数（如 session_id），不传递给 OpenAI
"""

import inspect
import logging
from typing import Any, Callable, Dict, List, Literal, Optional, TypeVar, Union

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
T = TypeVar('T', bound=BaseModel)


# ============================================================================
# 公共配置
# ============================================================================

# 常见的注入参数名称列表
INJECTED_PARAM_NAMES = {
    'session_id',    # 会话 ID
    'user_id',       # 用户 ID
    'context',       # 上下文对象
    'request',       # 请求对象
    'db',            # 数据库会话
    'db_session',    # 数据库会话
}


# ============================================================================
# Schema 生成器
# ============================================================================

class CleanGenerateJsonSchema:
    """清理版 Schema 生成器：移除多余字段并简化 Optional"""
    
    def __init__(self):
        from pydantic.json_schema import GenerateJsonSchema
        self.GenerateJsonSchema = GenerateJsonSchema
    
    def create(self):
        """创建自定义生成器类"""
        GenerateJsonSchema = self.GenerateJsonSchema
        
        class InnerCleanGenerateJsonSchema(GenerateJsonSchema):
            def generate(self, schema, mode='validation'):
                result = super().generate(schema, mode)
                result.pop('title', None)
                return result
            
            def field_title_schema(self, schema, current_state):
                return {}
        
        return InnerCleanGenerateJsonSchema


def _clean_schema_field(prop_schema: Dict[str, Any]) -> Dict[str, Any]:
    """清理字段属性，简化 anyOf 结构
    
    Args:
        prop_schema: 字段 Schema
        
    Returns:
        Dict: 清理后的字段 Schema
    """
    # 移除 title
    clean_prop = {k: v for k, v in prop_schema.items() if k != 'title'}
    
    # 简化 anyOf 结构
    if 'anyOf' in clean_prop:
        non_null_types = [t for t in clean_prop['anyOf'] if t.get('type') != 'null']
        
        if len(non_null_types) == 1:
            main_type = non_null_types[0]
            clean_prop = {
                **main_type,
                'default': clean_prop.get('default'),
                'description': clean_prop.get('description'),
            }
            clean_prop = {k: v for k, v in clean_prop.items() if v is not None}
    
    return clean_prop


def _camel_to_snake_case(name: str) -> str:
    """将驼峰命名转换为下划线命名
    
    Args:
        name: 驼峰命名的字符串
        
    Returns:
        str: 下划线命名的字符串
        
    Example:
        AddMemory → add_memory
        WeatherInput → weather_input
    """
    import re
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


# ============================================================================
# 主转换方法
# ============================================================================

def convert_to_openai_tool(
    model_or_func: Union[type[BaseModel], Callable],
    name: Optional[str] = None,
    description: Optional[str] = None,
    strict: bool = True
) -> Dict[str, Any]:
    """将 Pydantic 模型或函数转换为 OpenAI Function Calling 格式
    
    简化规则:
        - Pydantic 模型参数：作为工具参数传递给 OpenAI
        - 普通参数：作为注入参数（如 session_id），不传递给 OpenAI
    
    Args:
        model_or_func: Pydantic 模型类或函数
        name: 工具名称（可选，默认从模型/函数名推断）
        description: 工具描述（可选，默认从文档字符串获取）
        strict: 是否严格模式（默认 True）
        
    Returns:
        Dict: 符合 OpenAI Function Calling 格式的 Schema
        
    Examples:
        # 方式 1: Pydantic 模型
        class WeatherInput(BaseModel):
            location: str = Field(..., description="城市和国家")
            unit: Literal["celsius", "fahrenheit"] = Field(default="celsius")
        
        tool = convert_to_openai_tool(WeatherInput, description="获取天气信息")
        
        # 方式 2: 函数（Pydantic 模型参数 + 注入参数）
        def get_weather(input: WeatherInput, session_id: str) -> str:
            tool = convert_to_openai_tool(get_weather)
            # session_id 不会出现在 parameters 中
    """
    from pydantic.json_schema import GenerateJsonSchema
    
    CleanGen = CleanGenerateJsonSchema()
    CleanGenerateJsonSchemaClass = CleanGen.create()
    
    # 判断是模型还是函数
    if isinstance(model_or_func, type) and issubclass(model_or_func, BaseModel):
        # Pydantic 模型
        model_class = model_or_func
        
        # 自动推断名称和描述
        if name is None:
            name = _camel_to_snake_case(model_class.__name__.replace("Params", ""))
        if description is None:
            description = model_class.__doc__ or f"Execute {name}"
        
        # 生成 Schema
        clean_json_schema = model_class.model_json_schema(schema_generator=CleanGenerateJsonSchemaClass)
        
        # 构建 parameters
        openai_schema = {
            "type": "object",
            "properties": {},
            "required": clean_json_schema.get("required", []),
            "description": description if not hasattr(model_class, '__doc__') else None,
        }
        
        # 清理字段属性
        for prop_name, prop_schema in clean_json_schema.get("properties", {}).items():
            clean_prop = _clean_schema_field(prop_schema)
            openai_schema["properties"][prop_name] = clean_prop
        
        # 移除 None 值
        openai_schema = {k: v for k, v in openai_schema.items() if v is not None}
        
    elif callable(model_or_func):
        # 函数 - 实现完整的函数签名解析
        func = model_or_func
        sig = inspect.signature(func)
        
        if name is None:
            name = func.__name__
        if description is None:
            description = func.__doc__ or f"Execute {name}"
        
        # 解析函数参数
        openai_schema = {
            "type": "object",
            "properties": {},
            "required": [],
        }
        
        # 存储注入参数（不传递给 OpenAI）
        injected_params = set()
        
        for param_name, param in sig.parameters.items():
            param_type = param.annotation
            
            # ✅ 简化规则：检查是否是 Pydantic 模型类型
            if isinstance(param_type, type) and issubclass(param_type, BaseModel):
                # Pydantic 模型参数：展开所有字段到 parameters
                model_schema = param_type.model_json_schema(schema_generator=CleanGenerateJsonSchemaClass)
                
                # 添加模型的字段到主 schema
                for field_name, field_schema in model_schema.get("properties", {}).items():
                    clean_field = _clean_schema_field(field_schema)
                    openai_schema["properties"][field_name] = clean_field
                
                # 添加必填字段
                openai_schema["required"].extend(model_schema.get("required", []))
                
            # ✅ 简化规则：其他所有参数都视为注入参数
            else:
                injected_params.add(param_name)
                logger.debug(f"Detected injected parameter '{param_name}' for function {name}")
        
        # 添加描述
        openai_schema["description"] = description
        
        if injected_params:
            logger.info(f"Function {name} has {len(injected_params)} injected parameter(s): {injected_params}")
    else:
        raise ValueError("model_or_func must be a Pydantic model class or callable")
    
    # 包装成完整的 OpenAI 格式
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": openai_schema,
        }
    }


# ============================================================================
# 参数构建方法
# ============================================================================

def build_func_arguments(
    func: Callable,
    arguments: Dict[str, Any],
    inject_context: Optional[Dict[str, Any]] = None
) -> tuple[list, dict]:
    """根据函数签名自动构建参数
    
    简化规则:
        - Pydantic 模型参数：从 arguments 构建模型实例
        - 普通参数：从 inject_context 注入
    
    Args:
        func: 目标函数
        arguments: OpenAI 返回的参数（扁平化）
        inject_context: 需要注入的上下文（如 session_id）
        
    Returns:
        tuple: (args, kwargs) 用于调用函数
        
    Example:
        class WeatherInput(BaseModel):
            location: str
            unit: str
        
        def get_weather(input: WeatherInput, session_id: str):
            ...
        
        # OpenAI 返回：{"location": "Beijing", "unit": "celsius"}
        # 自动构建：(WeatherInput(location="Beijing", unit="celsius"), session_id="...")
    """
    sig = inspect.signature(func)
    
    args = []
    kwargs = {}
    
    for param_name, param in sig.parameters.items():
        param_type = param.annotation
        
        # ✅ Pydantic 模型参数：从 arguments 构建模型实例
        if isinstance(param_type, type) and issubclass(param_type, BaseModel):
            model_fields = {}
            model_schema = param_type.model_json_schema()
            
            for field_name in model_schema.get("properties", {}).keys():
                if field_name in arguments:
                    model_fields[field_name] = arguments[field_name]
            
            # 构建模型实例
            model_instance = param_type(**model_fields)
            args.append(model_instance)
            
        # ✅ 普通参数：从 inject_context 注入
        else:
            # 这是注入参数
            if inject_context and param_name in inject_context:
                kwargs[param_name] = inject_context[param_name]
            else:
                logger.warning(
                    f"Injected parameter '{param_name}' not found in context. "
                    f"Available keys: {list(inject_context.keys()) if inject_context else 'None'}"
                )
                # 如果有默认值则使用默认值
                if param.default != inspect.Parameter.empty:
                    kwargs[param_name] = param.default
    
    return args, kwargs


# ============================================================================
# 导出公共接口
# ============================================================================

__all__ = [
    'convert_to_openai_tool',
    'build_func_arguments',
    'INJECTED_PARAM_NAMES',
]
