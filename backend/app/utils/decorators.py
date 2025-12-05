from functools import wraps
import logging

from flask import jsonify

logger = logging.getLogger(__name__)


def handle_exceptions(func):
    """统一异常处理装饰器"""

    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            logger.exception(e)
            return jsonify({"success": False, "error": str(e)}), 500

    return wrapper
