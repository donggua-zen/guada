from datetime import datetime, timedelta, timezone


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
