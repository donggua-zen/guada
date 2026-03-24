"""
快速验证脚本 - 检查代码修改是否正确应用
"""

import sys
import os

# 设置路径
current_script_path = os.path.abspath(__file__)
current_directory = os.path.dirname(current_script_path)
sys.path.append(current_directory)
os.chdir(current_directory)

print("=" * 60)
print("Tokens Usage 记录功能 - 代码验证")
print("=" * 60)

# 1. 检查 LLMServiceChunk 是否有 usage 属性
print("\n1. 检查 LLMServiceChunk.usage 属性...")
try:
    from app.services.domain.llm_service import LLMServiceChunk
    chunk = LLMServiceChunk()
    if hasattr(chunk, 'usage'):
        print("   ✅ LLMServiceChunk 包含 usage 属性")
        print(f"      默认值：{chunk.usage}")
    else:
        print("   ❌ LLMServiceChunk 缺少 usage 属性")
except Exception as e:
    print(f"   ❌ 导入失败：{e}")

# 2. 检查 to_dict 方法是否包含 usage
print("\n2. 检查 to_dict() 方法...")
try:
    chunk = LLMServiceChunk()
    chunk.content = "test"
    chunk.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
    result = chunk.to_dict()
    if 'usage' in result:
        print("   ✅ to_dict() 包含 usage 字段")
        print(f"      返回值：{result}")
    else:
        print("   ❌ to_dict() 缺少 usage 字段")
except Exception as e:
    print(f"   ❌ 测试失败：{e}")

# 3. 检查 _handle_stream_chunk 方法签名
print("\n3. 检查 _handle_stream_chunk 方法...")
try:
    from app.services.domain.llm_service import LLMService
    import inspect
    source = inspect.getsource(LLMService._handle_stream_chunk)
    if 'hasattr(chunk, \'usage\')' in source:
        print("   ✅ _handle_stream_chunk 包含 usage 提取逻辑")
    else:
        print("   ⚠️  _handle_stream_chunk 可能缺少 usage 提取逻辑")
except Exception as e:
    print(f"   ❌ 检查失败：{e}")

# 4. 检查 AgentService._save_generation_resources
print("\n4. 检查 _save_generation_resources 方法...")
try:
    from app.services.agent_service import AgentService
    import inspect
    source = inspect.getsource(AgentService._save_generation_resources)
    if '"usage"' in source and 'complete_chunk.get("usage")' in source:
        print("   ✅ _save_generation_resources 包含 usage 保存逻辑")
    else:
        print("   ⚠️  _save_generation_resources 可能缺少 usage 保存逻辑")
except Exception as e:
    print(f"   ❌ 检查失败：{e}")

# 5. 检查日志输出
print("\n5. 检查日志配置...")
try:
    import logging
    logger = logging.getLogger('app.services.agent_service')
    print(f"   ✅ Logger 已配置：{logger.name}")
except Exception as e:
    print(f"   ❌ 日志配置失败：{e}")

print("\n" + "=" * 60)
print("代码验证完成！")
print("=" * 60)
print("\n下一步:")
print("1. 启动后端服务：python run.py")
print("2. 进行一次对话测试")
print("3. 查看日志中的 'Tokens saved: ...' 信息")
print("4. 运行完整测试：python test_usage_recording.py <message_content_id>")
