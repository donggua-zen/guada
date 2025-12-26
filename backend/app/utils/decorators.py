from functools import wraps
import logging

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def handle_response(func):
    """统一异常处理装饰器"""

    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            response = func(*args, **kwargs)
            if response:  # 响应不为空
                return response
        except Exception as e:
            logger.exception(e)
            raise HTTPException(status_code=500, detail=str(e))

    return wrapper
