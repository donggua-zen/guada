"""
测试 reset_database 模块可以正常导入和调用

注意：此测试不会实际执行重置操作，仅验证模块可导入
"""

import sys
from pathlib import Path

# 添加项目根目录到路径
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))


def test_import():
    """测试模块可以正常导入"""
    try:
        from reset_database import (
            disable_foreign_keys,
            enable_foreign_keys,
            clear_all_data,
            recreate_tables,
            create_default_user,
            create_model_provider,
            create_models,
            create_character,
            create_knowledge_base,
            create_global_settings,
            import_default_data,
            reset_database,
            main,
        )
        print("所有函数导入成功")
        return True
    except ImportError as e:
        print(f"❌ 导入失败：{e}")
        return False


def test_function_signatures():
    """测试函数签名"""
    from reset_database import (
        disable_foreign_keys,
        enable_foreign_keys,
        clear_all_data,
        recreate_tables,
        reset_database,
    )
    import inspect
    
    # 检查异步函数
    async_functions = [
        disable_foreign_keys,
        enable_foreign_keys,
        clear_all_data,
        recreate_tables,
        reset_database,
    ]
    
    for func in async_functions:
        if not inspect.iscoroutinefunction(func):
            print(f"❌ {func.__name__} 不是异步函数")
            return False
    
    print("所有函数签名正确")
    return True


if __name__ == "__main__":
    print("测试 reset_database 模块...")
    print("=" * 60)
    
    success = True
    success &= test_import()
    success &= test_function_signatures()
    
    print("=" * 60)
    if success:
        print("所有测试通过！模块可以正常导入和调用。")
    else:
        print("❌ 测试失败！")
        sys.exit(1)
