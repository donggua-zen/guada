# 测试编写快速指南

**适用对象**: 参与本项目测试开发的开发者  
**目标**: 保持测试风格一致，提高代码质量

---

## 📝 测试命名规范

### 格式

```python
test_<功能>_当_<条件>_应_<预期结果>
```

### 示例

✅ **推荐**:
```python
def test_create_session_when_title_provided_should_use_custom_title():
    """验证参数 title 优先于角色 title"""
    
def test_merge_settings_when_both_have_settings_should_prioritize_session():
    """验证设置合并策略：会话设置优先于角色设置"""
```

❌ **避免**:
```python
def test_session_title():  # 太模糊
def test_when_title_then_use_custom():  # 缺少功能描述
```

---

## 🏗️ 测试结构模板

### 单元测试模板

```python
"""
<模块名> 单元测试

测试范围:
1. <功能点 1>
2. <功能点 2>
3. <功能点 3>
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.<module> import <ServiceClass>


class Test<ServiceClass><Feature>:
    """测试 <功能名称>"""
    
    @pytest.fixture
    def mock_repos(self):
        """创建 Mock 仓库依赖"""
        return {
            "session_repo": AsyncMock(),
            "model_repo": AsyncMock(),
            # ... 其他依赖
        }
    
    @pytest.fixture
    async def service_instance(self, mock_repos):
        """创建服务实例"""
        service = <ServiceClass>(
            session_repo=mock_repos["session_repo"],
            # ... 其他依赖
        )
        yield service
    
    @pytest.mark.asyncio
    async def test_<场景>_当_<条件>_应_<结果>(self, service_instance, mock_repos):
        """测试描述"""
        # Arrange
        # ... 准备数据
        
        # Act
        # ... 执行操作
        
        # Assert
        # ... 验证结果
```

### 集成测试模板

```python
"""
<业务流程> 集成测试

测试范围:
1. 端到端流程
2. API 级别验证
3. 数据库交互
"""
import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_<业务场景>_当_<条件>_应_<结果>(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession,
    <factories>
):
    """测试描述"""
    # Arrange: 准备依赖数据
    # ... 创建模型、角色等
    
    # Act: 发送 HTTP 请求
    response = await client.post("/api/v1/<endpoint>", json=data)
    
    # Assert: 验证响应
    assert response.status_code == 200
    assert response.json()["field"] == expected_value
```

---

## 🔧 常用 Fixtures

### 全局 Fixtures (conftest.py)

```python
# client - HTTP 测试客户端
response = await client.post("/api/v1/sessions", json=data)

# test_db_session - 数据库会话（自动回滚）
test_db_session.add(entity)
await test_db_session.commit()

# user_factory - 用户工厂
user = await user_factory.create(
    email="test@example.com",
    nickname="Test User"
)

# character_factory - 角色工厂
character = await character_factory.create(
    title="Character Name",
    model_id=model_id
)

# session_factory - 会话工厂
session = await session_factory.create(
    title="Session Title",
    character_id=character.id
)

# tool_provider_factory - 工具提供者工厂
provider = tool_provider_factory.create_local()
provider.register(name="tool_name", func=lambda: "result", schema={})
```

### 辅助函数 (helpers.py)

```python
from app.tests.helpers import (
    assert_response_success,      # 断言响应成功
    create_tool_call_dict,        # 创建工具调用字典
    create_mock_message,          # 创建 Mock 消息
    has_tool_call_with_name,      # 检查是否包含指定工具调用
)

# 使用示例
assert_response_success(response, expected_status=200)

tool_call = create_tool_call_dict(
    tool_id="call-1",
    name="get_time",
    arguments={"timezone": "UTC"}
)
```

---

## ✅ 最佳实践

### 1. Arrange-Act-Assert 模式

```python
@pytest.mark.asyncio
async def test_example(self, service):
    # Arrange: 准备数据和 Mock
    mock_data = {"key": "value"}
    service.method = AsyncMock(return_value=mock_data)
    
    # Act: 执行被测试的操作
    result = await service.target_method(param="value")
    
    # Assert: 验证结果
    assert result == expected_value
    assert service.method.called_once()
```

### 2. 测试隔离

```python
# ✅ 每个测试使用独立的数据库事务
@pytest.fixture()
async def test_db_session(test_engine):
    connection = await test_engine.connect()
    transaction = await connection.begin()
    session = AsyncSession(bind=connection)
    yield session
    await transaction.rollback()  # 自动回滚
```

### 3. 清晰的断言

```python
# ❌ 不推荐：链式断言
assert response.status_code == 200 and response.json()["id"] is not None

# ✅ 推荐：分步断言
assert response.status_code == 200
data = response.json()
assert data["id"] is not None
assert data["title"] == "Expected Title"
```

### 4. 有意义的错误信息

```python
# ❌ 不推荐
assert result.title == "Custom"

# ✅ 推荐
assert result.title == "Custom", (
    f"Expected custom title 'Custom', but got '{result.title}'. "
    f"This indicates the title inheritance logic is broken."
)
```

---

## ⚠️ 常见陷阱

### 1. Mock 过度简化

```python
# ❌ 错误：Mock 返回类型不匹配
service.get_user = AsyncMock(return_value={"id": "123"})  # 返回 dict

# ✅ 正确：使用 MagicMock 模拟真实对象
mock_user = MagicMock()
mock_user.id = "123"
service.get_user = AsyncMock(return_value=mock_user)
```

### 2. 忘记清理异步资源

```python
# ❌ 错误
@pytest.fixture
async def service():
    s = Service()
    yield s
    # 没有清理

# ✅ 正确
@pytest.fixture
async def service():
    s = Service()
    yield s
    await s.cleanup()  # 清理资源
```

### 3. 测试依赖顺序

```python
# ❌ 错误：测试 B 依赖测试 A 的结果
def test_a_creates_data():
    global data
    data = create_data()

def test_b_uses_data():
    assert data.is_valid()  # 依赖 test_a

# ✅ 正确：每个测试独立
def test_a():
    data = create_data()
    assert data.is_valid()

def test_b():
    data = create_different_data()
    assert data.is_valid()
```

---

## 🐛 调试技巧

### 1. 使用 pytest 参数

```bash
# 运行特定测试
pytest -k "test_session_creation"

# 显示详细输出
pytest -v

# 显示本地变量
pytest -l

# 遇到错误立即停止
pytest -x
```

### 2. 添加调试信息

```python
@pytest.mark.asyncio
async def test_debug_example(self, caplog):
    # 启用日志捕获
    with caplog.at_level(logging.DEBUG):
        result = await service.method()
        print(f"DEBUG: Result = {result}")  # 控制台输出
        logging.debug(f"Service returned: {result}")  # 日志输出
```

### 3. 检查数据库状态

```python
@pytest.mark.asyncio
async def test_database_operation(self, test_db_session):
    # 添加数据
    test_db_session.add(entity)
    await test_db_session.commit()
    
    # 验证数据已保存
    from sqlalchemy import select
    result = await test_db_session.execute(select(Entity))
    saved = result.scalar_one()
    assert saved.id == entity.id
```

---

## 📚 参考资源

### 官方文档

- [pytest 官方文档](https://docs.pytest.org/)
- [pytest-asyncio 文档](https://github.com/pytest-dev/pytest-asyncio)
- [FastAPI 测试指南](https://fastapi.tiangolo.com/tutorial/testing/)

### 项目内文档

- [TESTING_ISSUES.md](docs/architecture/TESTING_ISSUES.md) - 待确认事项
- [TEST_REFACTORING_P0_SUMMARY.md](docs/architecture/TEST_REFACTORING_P0_SUMMARY.md) - P0 总结

---

## 💡 快速检查清单

在提交测试前，请确认：

- [ ] 测试命名符合规范
- [ ] 使用 `@pytest.mark.asyncio` 标记
- [ ] 遵循 Arrange-Act-Assert 模式
- [ ] 断言清晰且有错误信息
- [ ] 测试之间相互独立
- [ ] 使用了合适的 Fixtures
- [ ] 覆盖了正常和异常场景
- [ ] 注释完整（中文说明测试目的）

---

**最后更新**: 2026-03-29  
**维护者**: 开发团队
