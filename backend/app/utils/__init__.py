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
