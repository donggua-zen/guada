from functools import wraps
import logging

from flask import Response, jsonify

logger = logging.getLogger(__name__)


def handle_exceptions(func):
    """统一异常处理装饰器"""

    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            response = func(*args, **kwargs)
            if response:  # 响应不为空
                if isinstance(response, dict):  # 响应为字典
                    return jsonify({"success": True, "data": response})
                else:
                    return response
            else:  # 响应为空
                return jsonify({"success": True})
        except Exception as e:
            logger.exception(e)
            return jsonify({"success": False, "error": str(e)}), 500

    return wrapper
