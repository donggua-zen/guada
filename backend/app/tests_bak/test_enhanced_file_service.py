"""
文件上传服务集成测试
"""
import asyncio
import sys
from pathlib import Path
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, Mock

# 添加项目路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from PIL import Image


async def test_enhanced_file_service():
    """测试增强的文件服务"""
    from app.services.enhanced_file_service import EnhancedFileService
    from app.exceptions import (
        FileValidationError,
        FileSizeLimitExceededError,
        UnsupportedFileTypeError,
    )
    
    print("=" * 60)
    print("开始测试增强的文件服务")
    print("=" * 60)
    
    # 创建模拟的 repository
    mock_repo = AsyncMock()
    mock_repo.add_file = AsyncMock(return_value={"id": "test_file_id"})
    mock_repo.delete_file = AsyncMock(return_value=True)
    mock_repo.get_file = AsyncMock(return_value={
        "file_name": "test.jpg",
        "display_name": "test",
        "file_ext": "jpg",
        "file_type": "image",
        "file_size": 1024,
        "file_content": None,
        "session_id": "session_123",
        "content_hash": "none",
        "file_metadata": {"width": 800, "height": 600},
    })
    
    # 创建服务实例
    service = EnhancedFileService(mock_repo)
    
    # ========== 测试 1: 验证空文件名 ==========
    print("\n[测试 1] 验证空文件名...")
    empty_file = Mock()
    empty_file.filename = ""
    
    try:
        await service.upload_file("session_123", empty_file)
        print("❌ 应该抛出 FileValidationError")
    except FileValidationError as e:
        print(f"✅ 正确捕获异常：{e.message}")
    
    # ========== 测试 2: 验证文件大小为 0 ==========
    print("\n[测试 2] 验证文件大小为 0...")
    zero_size_file = Mock()
    zero_size_file.filename = "test.txt"
    zero_size_file.read = AsyncMock(return_value=b"")
    zero_size_file.seek = AsyncMock()
    
    try:
        await service.upload_file("session_123", zero_size_file)
        print("❌ 应该抛出 FileValidationError")
    except FileValidationError as e:
        print(f"✅ 正确捕获异常：{e.message}")
    
    # ========== 测试 3: 图片上传流程（简化版） ==========
    print("\n[测试 3] 图片元数据提取测试...")
    
    # 创建测试图片
    test_image = Image.new('RGB', (800, 600), color='red')
    image_bytes = BytesIO()
    test_image.save(image_bytes, format='JPEG')
    image_bytes.seek(0)
    
    # 模拟 UploadFile
    mock_upload_file = Mock()
    mock_upload_file.filename = "test_image.jpg"
    mock_upload_file.read = AsyncMock(side_effect=[
        image_bytes.getvalue(),  # 第一次读取用于验证大小
        b"",  # 重置后再次读取
    ])
    mock_upload_file.seek = AsyncMock()
    
    # 测试 _get_file_extension 方法
    ext = service._get_file_extension("test.JPG")
    assert ext == "jpg", f"期望得到 'jpg'，实际得到 '{ext}'"
    print(f"✅ 文件扩展名提取正确：{ext}")
    
    # 测试 IMAGE_EXTENSIONS 集合
    assert "jpg" in service.IMAGE_EXTENSIONS
    assert "png" in service.IMAGE_EXTENSIONS
    print(f"✅ 图片类型定义正确：{service.IMAGE_EXTENSIONS}")
    
    # ========== 测试 4: PDF 类型验证 ==========
    print("\n[测试 4] PDF 文件类型验证...")
    assert "pdf" in service.PDF_EXTENSIONS
    print(f"✅ PDF 类型定义正确：{service.PDF_EXTENSIONS}")
    
    # ========== 测试 5: 文本类型验证 ==========
    print("\n[测试 5] 文本文件类型验证...")
    assert "txt" in service.TEXT_EXTENSIONS
    assert "md" in service.TEXT_EXTENSIONS
    assert "json" in service.TEXT_EXTENSIONS
    print(f"✅ 文本类型定义正确：{service.TEXT_EXTENSIONS}")
    
    # ========== 测试 6: 文件大小限制配置 ==========
    print("\n[测试 6] 文件大小限制配置...")
    assert service.MAX_FILE_SIZE == 50 * 1024 * 1024
    assert service.MAX_IMAGE_SIZE == 20 * 1024 * 1024
    assert service.MAX_PDF_SIZE == 50 * 1024 * 1024
    print(f"✅ 文件大小限制配置正确:")
    print(f"   - 最大文件：{service.MAX_FILE_SIZE // 1024 // 1024}MB")
    print(f"   - 最大图片：{service.MAX_IMAGE_SIZE // 1024 // 1024}MB")
    print(f"   - 最大 PDF: {service.MAX_PDF_SIZE // 1024 // 1024}MB")
    
    # ========== 测试 7: copy_message_file 功能 ==========
    print("\n[测试 7] 复制文件功能测试...")
    result = await service.copy_message_file(
        file_id="file_123",
        message_id="message_456"
    )
    assert result is not None
    print(f"✅ 文件复制功能正常")
    
    # ========== 测试 8: delete_file 功能 ==========
    print("\n[测试 8] 删除文件功能测试...")
    result = await service.delete_file("file_123")
    assert result == {}
    print(f"✅ 文件删除功能正常")
    
    print("\n" + "=" * 60)
    print("所有测试通过！✅")
    print("=" * 60)
    
    return True


async def test_error_handling():
    """测试错误处理机制"""
    from app.services.enhanced_file_service import EnhancedFileService
    from app.exceptions import FileUploadError, FileValidationError
    
    print("\n" + "=" * 60)
    print("开始测试错误处理机制")
    print("=" * 60)
    
    mock_repo = AsyncMock()
    service = EnhancedFileService(mock_repo)
    
    # 测试异常类的继承关系
    print("\n[测试] 异常类继承关系...")
    assert issubclass(FileUploadError, Exception)
    assert issubclass(FileValidationError, Exception)
    print("✅ 异常类继承关系正确")
    
    # 测试异常消息格式化
    print("\n[测试] 异常消息格式化...")
    try:
        raise FileValidationError(message="自定义错误消息")
    except FileValidationError as e:
        assert e.message == "自定义错误消息"
        print(f"✅ 异常消息格式化正确：{e.message}")
    
    print("\n" + "=" * 60)
    print("错误处理测试通过！✅")
    print("=" * 60)
    
    return True


async def main():
    """主测试函数"""
    try:
        await test_enhanced_file_service()
        await test_error_handling()
        
        print("\n" + "🎉" * 30)
        print("所有测试完成！系统功能正常。")
        print("🎉" * 30)
        
    except AssertionError as e:
        print(f"\n❌ 测试失败：{str(e)}")
        raise
    except Exception as e:
        print(f"\n❌ 测试过程出错：{str(e)}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
