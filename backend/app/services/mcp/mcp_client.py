"""
MCP 客户端服务 (基于 JSON-RPC 2.0 协议)

该模块提供与 MCP (Model Context Protocol) 服务器通信的能力，包括：
1. 获取 MCP 服务器的工具列表
2. 调用 MCP 工具
3. 管理 MCP 连接

MCP 协议使用 JSON-RPC 2.0 作为通信标准：
- tools/list: 获取工具列表
- tools/call: 调用工具
"""

import logging
from typing import Any, Dict, List, Optional
import httpx

logger = logging.getLogger(__name__)


class MCPClient:
    """MCP 客户端类，用于与 MCP 服务器交互（基于 JSON-RPC 2.0）"""
    
    def __init__(self, base_url: str, headers: Optional[Dict[str, str]] = None):
        """
        初始化 MCP 客户端
        
        Args:
            base_url: MCP 服务器的基础 URL
            headers: HTTP 请求头
        """
        self.base_url = base_url.rstrip('/')
        self.headers = headers or {}
        
        # 确保设置 Content-Type
        if 'Content-Type' not in self.headers:
            self.headers['Content-Type'] = 'application/json'
    
    async def list_tools(self) -> List[Dict[str, Any]]:
        """
        获取 MCP 服务器的工具列表（使用 JSON-RPC 2.0 协议）
        
        Returns:
            List[Dict]: 工具列表，每个工具包含 name, description, input_schema 等字段
        """
        # JSON-RPC 2.0 请求体
        request_data = {
            "jsonrpc": "2.0",
            "method": "tools/list",
            "id": 1
        }
        
        logger.info(f"Fetching tools from MCP server (JSON-RPC): {self.base_url}")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.base_url,
                    headers=self.headers,
                    json=request_data,
                    timeout=30.0
                )
                response.raise_for_status()
                
                result = response.json()
                
                # 检查 JSON-RPC 响应格式
                if not isinstance(result, dict):
                    logger.error(f"Invalid JSON-RPC response (not a dict): {type(result)}")
                    return []
                
                # 检查是否有错误
                if 'error' in result:
                    error_msg = result.get('error', {}).get('message', 'Unknown error')
                    logger.error(f"JSON-RPC error: {error_msg}")
                    return []
                
                # 提取工具列表
                if 'result' not in result:
                    logger.warning(f"No result field in JSON-RPC response")
                    return []
                
                tools_result = result['result']
                if not isinstance(tools_result, dict):
                    logger.warning(f"Result is not a dict: {type(tools_result)}")
                    return []
                
                tools = tools_result.get('tools', [])
                
                if not isinstance(tools, list):
                    logger.warning(f"Tools is not a list: {type(tools)}")
                    return []
                
                logger.info(f"Successfully fetched {len(tools)} tools from {self.base_url}")
                return tools
                
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error while fetching tools: {e.status_code} - {e.response.text[:200]}")
            return []
        except httpx.RequestError as e:
            logger.error(f"Request error while fetching tools: {e}")
            return []
        except Exception as e:
            logger.error(f"Error fetching tools: {e}")
            return []
    
    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        调用 MCP 工具（使用 JSON-RPC 2.0 协议）
        
        Args:
            tool_name: 工具名称
            arguments: 工具调用参数
            
        Returns:
            Dict: 工具调用结果
        """
        # JSON-RPC 2.0 请求体
        request_data = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            },
            "id": 1
        }
        
        logger.info(f"Calling MCP tool (JSON-RPC): {tool_name} at {self.base_url}")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.base_url,
                    headers=self.headers,
                    json=request_data,
                    timeout=60.0
                )
                response.raise_for_status()
                
                result = response.json()
                
                # 检查 JSON-RPC 响应
                if not isinstance(result, dict):
                    error_msg = f"Invalid response type: {type(result)}"
                    logger.error(error_msg)
                    return {"error": True, "message": error_msg}
                
                # 检查错误
                if 'error' in result:
                    error_msg = result.get('error', {}).get('message', 'Unknown error')
                    logger.error(f"Tool call error: {error_msg}")
                    return {"error": True, "message": error_msg}
                
                # 提取结果
                if 'result' not in result:
                    error_msg = "No result field in response"
                    logger.error(error_msg)
                    return {"error": True, "message": error_msg}
                
                tool_result = result['result']
                
                logger.info(f"Tool {tool_name} called successfully")
                return {
                    "success": True,
                    "result": tool_result,
                    "content": str(tool_result) if not isinstance(tool_result, str) else tool_result
                }
                
        except httpx.HTTPStatusError as e:
            error_msg = f"HTTP error: {e.status_code}"
            logger.error(error_msg)
            return {"error": True, "message": error_msg}
        except httpx.RequestError as e:
            error_msg = f"Request error: {e}"
            logger.error(error_msg)
            return {"error": True, "message": error_msg}
        except Exception as e:
            error_msg = f"Exception: {str(e)}"
            logger.error(error_msg)
            return {"error": True, "message": error_msg}
    
    async def health_check(self) -> bool:
        """
        检查 MCP 服务器是否可用（通过简单的 GET 请求）
        
        Returns:
            bool: 服务器是否健康
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(self.base_url, headers=self.headers, timeout=5.0)
                # 如果能访问，说明服务器在线
                return response.status_code in [200, 204, 404, 405]
        except Exception as e:
            logger.error(f"Health check failed for {self.base_url}: {e}")
            return False