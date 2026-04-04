# 验证脚本使用指南

## 📁 目录结构

```
backend/
└── tests/
    └── verification/          # ← 新增：验证脚本专用目录
        ├── README.md          # 详细说明文档
        └── verify_hybrid_search.py  # 混合搜索验证脚本
```

## 🎯 为什么创建验证脚本目录？

### 开发中的痛点

1. **pytest 太重**: 需要完整环境、数据库配置、fixture 设置
2. **快速验证需求**: 开发新功能时，需要快速测试核心逻辑
3. **调试复杂算法**: 需要手动控制数据，观察每一步输出
4. **第三方 API 测试**: 只需验证 API 调用和算法，不需要数据库

### 解决方案

`tests/verification/` 目录提供了：
- ✅ **轻量级**: 直接运行 Python 脚本，无需 pytest
- ✅ **独立性**: 不依赖数据库，手动编写测试数据
- ✅ **灵活性**: 可以快速修改、调试、重跑
- ✅ **实用性**: 专注于核心功能验证

## 🚀 快速开始

### 1. 查看示例

```bash
cd backend
python tests\verification\verify_hybrid_search.py
```

### 2. 运行结果示例

```
================================================================================
  🔍 混合搜索功能验证 - 硅基流动 API
================================================================================

API 地址：https://api.siliconflow.cn/v1/
向量模型：Qwen/Qwen3-Embedding-8B
测试知识库 ID: verify_hybrid_kb_001


================================================================================
  Step 1: 环境设置验证
================================================================================

[PASS] API 地址配置
   https://api.siliconflow.cn/v1/
[PASS] 模型名称配置
   Qwen/Qwen3-Embedding-8B
[PASS] 测试知识库 ID
   verify_hybrid_kb_001

... (更多输出)

✅ 所有验证通过！混合搜索功能工作正常
```

## 📝 验证脚本的核心特点

### 1. 不依赖数据库

```python
# ❌ 避免：从数据库加载
from app.models.knowledge_base import KnowledgeBase
kb = await kb_repo.get_kb("xxx")

# ✅ 推荐：手动创建数据
test_chunks = [
    {
        "content": "FastAPI is a modern framework",
        "chunk_index": 0,
        "metadata": {"file_id": "file_001"}
    }
]
```

### 2. 直接使用服务类

```python
from app.services.vector_service import VectorService

vector_service = VectorService()

# 直接调用服务方法，传入手动数据
results = vector_service._fuse_and_rerank(
    semantic_results=mock_semantic,
    keyword_results=mock_keyword,
    semantic_weight=0.6,
    keyword_weight=0.4,
    top_k=5
)
```

### 3. 清晰的步骤划分

```python
async def main():
    """主验证流程"""
    # Step 1: 环境设置
    await verify_environment_setup()
    
    # Step 2: 向量嵌入 API
    embeddings = await verify_embedding_api()
    
    # Step 3: 手动创建测试数据
    test_chunks = await verify_test_data_manually()
    
    # Step 4: 语义搜索模拟
    semantic_results = await verify_semantic_search_manual(test_chunks)
    
    # Step 5: BM25 搜索模拟
    keyword_results = await verify_bm25_search_manual(test_chunks)
    
    # Step 6: 混合搜索验证
    hybrid_results = await verify_hybrid_search_manual(
        semantic_results, 
        keyword_results
    )
    
    # Step 7: 汇总结果
    print_section("验证结果汇总")
```

### 4. 统一的输出格式

```python
def print_section(title: str):
    """打印分隔线"""
    print("\n" + "="*80)
    print(f"  {title}")
    print("="*80 + "\n")


def print_result(title: str, success: bool, message: str = ""):
    """打印测试结果"""
    status = "[PASS]" if success else "[FAIL]"
    print(f"{status} {title}")
    if message:
        print(f"   {message}")
```

## 🔧 如何编写自己的验证脚本？

### 模板

```python
"""
验证脚本名称

用途说明：
1. 验证功能点 1
2. 验证功能点 2
3. ...

使用方法:
    python tests/verification/verify_xxx.py

注意：此脚本不是 pytest 测试，而是开发验证脚本
"""

import asyncio
import sys
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

# 导入需要的服务类
from app.services.xxx_service import XxxService


# ============================================================================
# 测试配置
# ============================================================================

TEST_CONFIG = {
    "api_key": "your-api-key",
    "model": "model-name",
}


# ============================================================================
# 辅助函数
# ============================================================================

def print_section(title: str):
    print("\n" + "="*80)
    print(f"  {title}")
    print("="*80 + "\n")


def print_result(title: str, success: bool, message: str = ""):
    status = "[PASS]" if success else "[FAIL]"
    print(f"{status} {title}")
    if message:
        print(f"   {message}")


# ============================================================================
# 验证步骤
# ============================================================================

async def verify_step_1():
    """步骤 1: 环境设置"""
    print_section("Step 1: 环境设置验证")
    print_result("配置检查", True, "配置正确")


async def verify_step_2():
    """步骤 2: 核心功能验证"""
    print_section("Step 2: 核心功能验证")
    
    # 手动创建测试数据
    test_data = [...]
    
    # 调用服务方法
    service = XxxService()
    result = await service.some_method(test_data)
    
    # 验证结果
    print_result("功能测试", len(result) > 0, f"返回 {len(result)} 条结果")


async def main():
    """主验证流程"""
    print_section("验证标题")
    
    try:
        await verify_step_1()
        await verify_step_2()
        
        # 汇总结果
        print_section("验证结果汇总")
        print("✅ 所有验证通过！")
        
    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        print_section("验证完成")


if __name__ == "__main__":
    asyncio.run(main())
```

### 步骤

1. **复制模板**: 基于 `verify_hybrid_search.py` 创建新脚本
2. **修改配置**: 更新 TEST_CONFIG 和导入的服务类
3. **编写测试数据**: 手动创建符合需求的测试数据
4. **调用服务方法**: 直接调用核心业务逻辑
5. **运行验证**: `python tests\verification\verify_xxx.py`
6. **调试优化**: 根据输出调整代码

## 📋 最佳实践

### ✅ DO (推荐)

- 手动编写测试数据
- 直接调用服务类方法
- 保持脚本简洁（< 500 行）
- 清晰的步骤划分
- 统一的输出格式
- 异常处理和错误信息

### ❌ DON'T (禁止)

- 引用数据库 Model（KnowledgeBase, ModelProvider 等）
- 使用 Repository 层
- 依赖数据库状态
- 使用 pytest 框架（assert, fixture 等）
- 包含复杂的数据库操作
- 超过 1000 行的脚本

## 🎯 典型使用场景

### 场景 1: 新功能开发

开发混合搜索功能时，需要验证：
1. 向量嵌入获取是否正常
2. BM25 算法是否工作
3. 融合重排序是否正确

👉 使用验证脚本快速测试核心逻辑

### 场景 2: 第三方 API 集成

集成硅基流动 API 时，需要验证：
1. API Key 是否有效
2. 模型名称是否正确
3. 响应格式是否符合预期

👉 使用验证脚本独立测试 API 调用

### 场景 3: 复杂算法调试

调试融合重排序算法时，需要：
1. 手动控制输入数据
2. 观察每一步的计算结果
3. 验证公式是否正确

👉 使用验证脚本逐步输出中间结果

### 场景 4: 性能问题排查

某功能性能下降，需要：
1. 隔离问题模块
2. 单独测试各组件
3. 对比不同实现

👉 使用验证脚本快速切换不同配置

## 🔄 与 pytest 的关系

```
开发流程：
1. 开发新功能 → 使用验证脚本快速测试 ✓
2. 功能稳定后 → 编写 pytest 单元测试 ✓
3. CI/CD 集成 → 运行 pytest 自动化测试 ✓

验证脚本         pytest 测试
  ├─ 临时性         ├─ 永久性
  ├─ 手动数据       ├─ 自动数据
  ├─ 快速迭代       ├─ 稳定回归
  └─ 开发工具       └─ 质量保证
```

## 📊 现有验证脚本

| 脚本 | 用途 | 依赖 | 运行时间 |
|------|------|------|---------|
| `verify_hybrid_search.py` | 混合搜索全流程验证 | 硅基流动 API | ~15 秒 |

## 🔗 相关文档

- [README.md](README.md) - 详细说明文档
- [verify_hybrid_search.py](verify_hybrid_search.py) - 示例脚本

---

**最后更新**: 2026-04-03  
**维护者**: 开发团队
