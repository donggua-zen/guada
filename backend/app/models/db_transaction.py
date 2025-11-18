from contextlib import contextmanager
from .database import db
import logging
from threading import local

logger = logging.getLogger(__name__)

# 线程局部存储，用于跟踪事务状态
_thread_local = local()


class SmartTransactionManager:
    def __init__(self):
        pass

    def _get_transaction_depth(self):
        """获取当前线程的事务深度"""
        if not hasattr(_thread_local, "transaction_depth"):
            _thread_local.transaction_depth = 0
        return _thread_local.transaction_depth

    def _set_transaction_depth(self, depth):
        """设置当前线程的事务深度"""
        _thread_local.transaction_depth = depth

    def is_in_transaction(self):
        """检查当前是否在事务中"""
        return self._get_transaction_depth() > 0

    @contextmanager
    def transaction(self):
        current_depth = self._get_transaction_depth()
        is_outermost = current_depth == 0

        logger.debug(f"事务开始 - 深度: {current_depth}, 最外层: {is_outermost}")

        try:
            self._set_transaction_depth(current_depth + 1)
            # if is_outermost:
            #     db.session.begin()  # 显式开始事务

            yield

            if is_outermost:
                db.session.commit()
                logger.debug("事务提交成功")

        except Exception as e:
            logger.debug(f"事务异常: {e}")
            if is_outermost:
                db.session.rollback()
                logger.debug("事务回滚")
            raise
        finally:
            self._set_transaction_depth(current_depth)
            logger.debug(f"事务结束 - 深度恢复为: {current_depth}")

    def execute_in_transaction(self, func, *args, **kwargs):
        """
        创建一个在数据库事务中执行指定函数的装饰器

        :param func: 需要在事务中执行的函数
        :param args: 函数的位置参数
        :param kwargs: 函数的关键字参数
        :return: 包装后的函数，该函数会在事务上下文中执行原函数
        """

        def wrapper(*args, **kwargs):
            """在事务中执行函数（便捷方法）"""
            # 使用事务上下文管理器执行函数
            with self.transaction():
                return func(*args, **kwargs)

        return wrapper


# 全局智能事务管理器实例
smart_transaction_manager = SmartTransactionManager()
