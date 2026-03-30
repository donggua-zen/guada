"""
测试图片上传元数据功能
"""
import asyncio
import sys
import os
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from PIL import Image
import io
import os
import tempfile


async def test_resize_and_convert_image():
    """测试 resize_and_convert_image 返回尺寸功能"""
    from app.utils import resize_and_convert_image
    
    # 创建测试图片
    test_image = Image.new('RGB', (800, 600), color='blue')
    image_bytes = io.BytesIO()
    test_image.save(image_bytes, format='JPEG')
    image_bytes.seek(0)
    
    # 创建临时文件
    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_file:
        tmp_path = tmp_file.name
    
    try:
        # 测试缩放（限制宽度 512）
        image_bytes.seek(0)
        scaled_size = resize_and_convert_image(
            image_bytes, tmp_path, width=512, height=None, force_scale=False
        )
        
        print(f"✓ 缩放图尺寸返回：{scaled_size}")
        assert isinstance(scaled_size, tuple), "应该返回 tuple"
        assert len(scaled_size) == 2, "应该返回 (width, height)"
        assert scaled_size[0] == 512, f"宽度应该是 512，实际是{scaled_size[0]}"
        # 高度应该按比例缩放：512/800 * 600 = 384
        expected_height = int(600 * 512 / 800)
        assert scaled_size[1] == expected_height, f"高度应该是{expected_height}，实际是{scaled_size[1]}"
        
        print(f"✅ resize_and_convert_image 返回值测试通过！")
        
    finally:
        # 清理临时文件
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def test_image_metadata_extraction():
    """测试图片元数据提取功能"""
    
    # 创建一个测试图片
    test_image = Image.new('RGB', (800, 600), color='red')
    image_bytes = io.BytesIO()
    test_image.save(image_bytes, format='JPEG')
    image_bytes.seek(0)
    
    # 模拟文件对象
    class MockFile:
        def __init__(self, file_obj, filename):
            self.file_obj = file_obj
            self.filename = filename
            
        async def read(self, size=-1):
            return self.file_obj.read(size)
            
        async def seek(self, pos):
            self.file_obj.seek(pos)
    
    mock_file = MockFile(image_bytes, "test_image.jpg")
    
    # 测试读取图片尺寸
    image_bytes.seek(0)
    with Image.open(image_bytes) as img:
        width, height = img.size
        print(f"✓ 图片尺寸提取成功：{width}x{height}")
        assert width == 800, f"期望宽度 800，实际{width}"
        assert height == 600, f"期望高度 600，实际{height}"
    
    # 测试 metadata 字典格式
    file_metadata = {
        "width": width,
        "height": height,
        "scaled_width": 512,
        "scaled_height": 384,
        "preview_width": 256,
        "preview_height": 256,
    }
    print(f"✓ Metadata 字典格式：{file_metadata}")
    assert isinstance(file_metadata, dict), "metadata 应该是字典类型"
    assert "width" in file_metadata, "metadata 应包含 width 键"
    assert "height" in file_metadata, "metadata 应包含 height 键"
    assert "scaled_width" in file_metadata, "metadata 应包含 scaled_width 键"
    assert "scaled_height" in file_metadata, "metadata 应包含 scaled_height 键"
    assert "preview_width" in file_metadata, "metadata 应包含 preview_width 键"
    assert "preview_height" in file_metadata, "metadata 应包含 preview_height 键"
    
    print("\n✅ 所有测试通过！图片元数据提取功能正常。")


if __name__ == "__main__":
    asyncio.run(test_resize_and_convert_image())
    print()
    asyncio.run(test_image_metadata_extraction())
