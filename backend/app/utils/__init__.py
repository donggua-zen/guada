from datetime import datetime, timedelta, timezone
import os
from config import STATIC_FILES_DIR


def to_utc8_isoformat(dt: datetime):
    """
    将给定的datetime对象转换为东八区ISO格式字符串

    参数:
        dt (datetime): 需要转换的datetime对象

    返回:
        str: 转换后的东八区ISO格式时间字符串
    """
    if dt.tzinfo is None:
        # 如果时间没有时区信息，假设为UTC
        dt = dt.replace(tzinfo=timezone.utc)
    # 创建东八区时区对象
    beijing_tz = timezone(timedelta(hours=8))
    # 将时间转换为东八区时间
    beijing_time = dt.astimezone(beijing_tz)
    return beijing_time.isoformat()


def convert_image_to_jpeg(file, file_path, size=None):
    """
    将图片文件转换为JPEG格式并保存到指定路径

    参数:
        file: 图片文件对象或文件路径，支持多种图片格式
        file_path: 转换后JPEG图片的保存路径
        size: 可选参数，指定转换后图片的尺寸，格式为(width, height)的元组

    返回值:
        无返回值，直接将转换后的JPEG图片保存到指定路径
    """

    from PIL import Image

    # 打开图片并转换为RGB模式(去除alpha通道)
    image = Image.open(file)
    if image.mode in ("RGBA", "LA", "P"):
        # 如果图片有透明通道，转换为RGB并添加白色背景
        background = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode == "P":
            image = image.convert("RGBA")
        background.paste(
            image, mask=image.split()[-1] if image.mode == "RGBA" else None
        )
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")

    # 如果指定了尺寸，则调整图片大小
    if size is not None:
        image = image.resize(size, Image.LANCZOS)

    # 保存为JPEG格式
    image.save(file_path, "JPEG", quality=95)


def resize_and_convert_image(
    file, output_path, width=None, height=None, force_scale=True
):
    """
    调整图片尺寸并转换为JPEG格式保存

    参数:
        file: 图片文件对象或文件路径，支持多种图片格式
        output_path: 转换后JPEG图片的保存路径
        width: 可选参数，目标宽度，如果为None则按高度等比例缩放
        height: 可选参数，目标高度，如果为None则按宽度等比例缩放

    返回值:
        无返回值，直接将转换后的JPEG图片保存到指定路径

    说明:
        - 如果width和height都为None: 保持原尺寸
        - 如果只提供width: 按宽度等比例缩放，高度自动计算
        - 如果只提供height: 按高度等比例缩放，宽度自动计算
        - 如果同时提供width和height: 裁剪缩放，保证图片完全填充目标尺寸
    """

    from PIL import Image

    # 打开图片并转换为RGB模式(去除alpha通道)
    image = Image.open(file)
    if image.mode in ("RGBA", "LA", "P"):
        # 如果图片有透明通道，转换为RGB并添加白色背景
        background = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode == "P":
            image = image.convert("RGBA")
        background.paste(
            image, mask=image.split()[-1] if image.mode == "RGBA" else None
        )
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")

    original_width, original_height = image.size

    # 根据不同的参数组合处理图片尺寸
    if width is None and height is None:
        # 情况1: 不调整尺寸，保持原样
        pass
    elif (
        not force_scale
        and (width is None or width > original_width)
        and (height is None or height > original_height)
    ):
        pass
    elif width is not None and height is None:
        # 情况2: 只提供宽度，高度按比例计算
        ratio = width / original_width
        new_height = int(original_height * ratio)
        image = image.resize((width, new_height), Image.LANCZOS)

    elif width is None and height is not None:
        # 情况3: 只提供高度，宽度按比例计算
        ratio = height / original_height
        new_width = int(original_width * ratio)
        image = image.resize((new_width, height), Image.LANCZOS)

    else:
        # 情况4: 同时提供宽度和高度，进行裁剪缩放
        # 计算缩放比例，选择能完全覆盖目标尺寸的最小比例
        ratio = max(width / original_width, height / original_height)
        new_width = int(original_width * ratio)
        new_height = int(original_height * ratio)

        # 先缩放图片
        resized_image = image.resize((new_width, new_height), Image.LANCZOS)

        # 计算裁剪区域（居中裁剪）
        left = (new_width - width) // 2
        top = (new_height - height) // 2
        right = left + width
        bottom = top + height

        # 裁剪图片
        image = resized_image.crop((left, top, right, bottom))

    # 保存为JPEG格式
    image.save(output_path, "JPEG", quality=95)


def remove_file(file_path):
    """
    删除指定文件

    参数:
        file_path: 文件路径

    返回值:
        无返回值，直接删除文件
    """
    import os

    try:
        os.remove(file_path)
        return True
    except:
        return False


def build_url_path(*path_parts):
    """构建URL路径，确保以/开头且各部分用/连接"""
    cleaned_parts = [part.strip("/") for part in path_parts if part]
    return "/" + "/".join(cleaned_parts)


def convert_webpath_to_filepath(web_path):
    # 检测路径是否包含?，若有则将?及其后面的内容删除
    if "?" in web_path:
        web_path = web_path.split("?")[0]
    web_path = web_path.strip("/\\")
    if web_path.startswith("static"):
        # 只替换开头的 static/ 部分，然后正确拼接路径
        relative_path = web_path[len("static") + 1 :]
        file_path = os.path.join(str(STATIC_FILES_DIR), relative_path)
        return file_path
    raise ValueError("无效的web路径")
