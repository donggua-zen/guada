"""调试命名空间推导"""

from app.services.tools.providers.tool_provider_base import IToolProvider
from abc import ABC, abstractmethod
from typing import Any, Dict


class TestMemoryProvider(IToolProvider):
    async def get_tools(self):
        return {"add_memory": {}}
    
    async def execute(self, request):
        pass
    
    async def is_available(self, tool_name):
        return True


# 测试
provider = TestMemoryProvider()
print(f"Class name: {provider.__class__.__name__}")
print(f"Ends with 'ToolProvider': {provider.__class__.__name__.endswith('ToolProvider')}")
print(f"Namespace property: {provider.namespace}")

# 手动推导
class_name = provider.__class__.__name__
if class_name.endswith('ToolProvider'):
    namespace = class_name[:-12]
    print(f"Derived namespace: {namespace}")
else:
    print("Does not end with ToolProvider")
