"""
测试运行脚本
用于运行backend项目中的测试
"""

import subprocess
import sys
import os

def install_test_dependencies():
    """安装测试所需的依赖"""
    print("正在安装测试依赖...")
    dependencies = [
        "pytest",
        "pytest-asyncio",
        "requests",
        "httpx",
        "sqlalchemy",
        "aiosqlite",
        "async-asgi-testclient"
    ]
    
    for dep in dependencies:
        try:
            __import__(dep)
            print(f"{dep} 已安装")
        except ImportError:
            print(f"正在安装 {dep}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", dep])

def run_tests():
    """运行测试"""
    try:
        # 定义要运行的测试文件列表
        test_files = [
            "app/tests/test_messages_route.py",
            "app/tests/integration/test_characters_route.py",
            "app/tests/integration/test_models_route.py",
            "app/tests/integration/test_chat_route.py",
            "app/tests/integration/test_sessions_route.py",
            "app/tests/integration/test_files_route.py",
            "app/tests/integration/test_users_route.py",
            "app/tests/integration/test_settings_route.py"
        ]
        
        all_success = True
        for test_file in test_files:
            print(f"运行测试: {test_file}")
            result = subprocess.run([
                sys.executable, "-m", "pytest", 
                test_file, 
                "-v", "--tb=short"
            ], cwd=os.path.dirname(__file__))
            
            if result.returncode != 0:
                all_success = False
        
        return all_success
    except Exception as e:
        print(f"运行测试时出错: {e}")
        return False

def run_tests_manual():
    """手动运行测试，不使用pytest"""
    print("正在运行测试...")
    
    # 导入并运行测试
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))
    sys.path.insert(0, os.path.dirname(__file__))
    
    try:
        # 尝试导入测试文件以检查语法
        import importlib.util
        test_files = [
            ("test_messages_route", "app/tests/test_messages_route.py"),
            ("test_characters_route", "app/tests/integration/test_characters_route.py"),
            ("test_models_route", "app/tests/integration/test_models_route.py"),
            ("test_chat_route", "app/tests/integration/test_chat_route.py"),
            ("test_sessions_route", "app/tests/integration/test_sessions_route.py"),
            ("test_files_route", "app/tests/integration/test_files_route.py"),
            ("test_users_route", "app/tests/integration/test_users_route.py"),
            ("test_settings_route", "app/tests/integration/test_settings_route.py")
        ]
        
        for module_name, file_path in test_files:
            spec = importlib.util.spec_from_file_location(
                module_name, 
                os.path.join(os.path.dirname(__file__), file_path)
            )
            test_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(test_module)
        
        print("测试文件语法检查通过")
        print("要运行完整测试，请安装pytest: pip install pytest pytest-asyncio")
        return True
    except SyntaxError as e:
        print(f"测试文件语法错误: {e}")
        return False
    except Exception as e:
        print(f"导入测试文件时出错: {e}")
        return False

if __name__ == "__main__":
    print("AI聊天系统后端测试运行器")
    print("=" * 40)
    
    # 检查pytest是否已安装
    install_test_dependencies()
    
    try:
        import pytest
        print("Pytest 已安装，正在运行测试...")
        success = run_tests()
    except ImportError:
        print("Pytest 未安装，将进行语法检查...")
        success = run_tests_manual()
    
    if success:
        print("\n测试完成")
    else:
        print("\n测试失败")
        sys.exit(1)