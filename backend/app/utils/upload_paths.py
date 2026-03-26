"""
文件上传路径管理工具

提供统一的文件上传路径配置和管理，避免硬编码路径字符串。

使用示例:
    from app.utils import upload_paths
    
    # 获取图片上传目录
    images_dir = upload_paths.get_images_upload_dir()
    
    # 构建文件保存路径
    file_path = upload_paths.build_image_save_path("unique_filename.jpg")
    
    # 转换为 Web 路径
    web_url = upload_paths.to_web_path(file_path)
"""
import os
from pathlib import Path
from typing import Tuple
from app.config import settings


class UploadPathConfig:
    """文件上传路径配置类
    
    集中管理所有文件上传相关的路径配置，包括：
    - 文件系统路径（绝对路径）
    - Web 路径（相对路径，用于 URL）
    - 目录自动创建
    """
    
    # ========== 基础路径配置 ==========
    
    # 静态文件根目录（从 settings 获取）
    STATIC_ROOT: Path = settings.STATIC_FILES_DIR
    
    # 上传根目录（相对于 STATIC_ROOT）
    UPLOAD_ROOT_SUBDIR: str = "uploads"
    
    # ========== 子目录配置 ==========
    
    # 图片上传子目录
    IMAGES_SUBDIR: str = "images"
    PREVIEWS_SUBDIR: str = "previews"
    
    # 文件上传子目录
    FILES_SUBDIR: str = "files"
    
    # 头像上传子目录（与 upload_service.py 保持一致）
    AVATARS_SUBDIR: str = "avatars"
    
    # ========== 路径属性（只读） ==========
    
    @property
    def upload_root(self) -> Path:
        """上传根目录的绝对路径"""
        return self.STATIC_ROOT / self.UPLOAD_ROOT_SUBDIR
    
    @property
    def images_dir(self) -> Path:
        """图片上传目录的绝对路径"""
        return self.upload_root / self.IMAGES_SUBDIR
    
    @property
    def previews_dir(self) -> Path:
        """预览图目录的绝对路径"""
        return self.upload_root / self.PREVIEWS_SUBDIR
    
    @property
    def files_dir(self) -> Path:
        """文件上传目录的绝对路径"""
        return self.upload_root / self.FILES_SUBDIR
    
    @property
    def avatars_dir(self) -> Path:
        """头像上传目录的绝对路径"""
        return self.STATIC_ROOT / self.AVATARS_SUBDIR
    
    # ========== Web 路径前缀 ==========
    
    @property
    def images_web_prefix(self) -> str:
        """图片 Web 路径前缀"""
        return f"/static/{self.UPLOAD_ROOT_SUBDIR}/{self.IMAGES_SUBDIR}"
    
    @property
    def previews_web_prefix(self) -> str:
        """预览图 Web 路径前缀"""
        return f"/static/{self.UPLOAD_ROOT_SUBDIR}/{self.PREVIEWS_SUBDIR}"
    
    @property
    def files_web_prefix(self) -> str:
        """文件 Web 路径前缀"""
        return f"/static/{self.UPLOAD_ROOT_SUBDIR}/{self.FILES_SUBDIR}"
    
    @property
    def avatars_web_prefix(self) -> str:
        """头像 Web 路径前缀"""
        return f"/static/{self.AVATARS_SUBDIR}"
    
    # ========== 初始化方法 ==========
    
    def __init__(self):
        """初始化时确保所有上传目录存在"""
        self.ensure_directories()
    
    def ensure_directories(self) -> None:
        """确保所有上传目录存在，不存在则自动创建"""
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.previews_dir.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.avatars_dir.mkdir(parents=True, exist_ok=True)
    
    # ========== 公共方法 ==========
    
    def get_images_upload_dir(self) -> Path:
        """
        获取图片上传目录的绝对路径
        
        Returns:
            Path: 图片上传目录路径
        """
        return self.images_dir
    
    def get_previews_upload_dir(self) -> Path:
        """
        获取预览图上传目录的绝对路径
        
        Returns:
            Path: 预览图上传目录路径
        """
        return self.previews_dir
    
    def get_files_upload_dir(self) -> Path:
        """
        获取文件上传目录的绝对路径
        
        Returns:
            Path: 文件上传目录路径
        """
        return self.files_dir
    
    def get_avatars_upload_dir(self) -> Path:
        """
        获取头像上传目录的绝对路径
        
        Returns:
            Path: 头像上传目录路径
        """
        return self.avatars_dir
    
    def build_image_save_path(self, filename: str) -> Path:
        """
        构建图片保存的完整路径
        
        Args:
            filename: 文件名（包含扩展名）
            
        Returns:
            Path: 完整的文件保存路径
        """
        return self.images_dir / filename
    
    def build_preview_save_path(self, filename: str) -> Path:
        """
        构建预览图保存的完整路径
        
        Args:
            filename: 文件名（包含扩展名）
            
        Returns:
            Path: 完整的预览图保存路径
        """
        return self.previews_dir / filename
    
    def build_file_save_path(self, filename: str) -> Path:
        """
        构建文件保存的完整路径
        
        Args:
            filename: 文件名（包含扩展名）
            
        Returns:
            Path: 完整的文件保存路径
        """
        return self.files_dir / filename
    
    def build_avatar_save_path(self, filename: str) -> Path:
        """
        构建头像保存的完整路径
        
        Args:
            filename: 文件名（包含扩展名）
            
        Returns:
            Path: 完整的头像保存路径
        """
        return self.avatars_dir / filename
    
    def to_web_path(self, file_path: Path, subdir: str) -> str:
        """
        将文件系统路径转换为 Web 路径
        
        Args:
            file_path: 文件的绝对路径
            subdir: 子目录名称（images/previews/files/avatars）
            
        Returns:
            str: Web 访问路径（以 / 开头）
        """
        if not isinstance(file_path, (Path, str)):
            raise TypeError("file_path 必须是 Path 或 str 类型")
        
        file_path = Path(file_path)
        filename = file_path.name
        
        # 根据子目录返回对应的 Web 路径前缀
        web_prefix_map = {
            "images": self.images_web_prefix,
            "previews": self.previews_web_prefix,
            "files": self.files_web_prefix,
            "avatars": self.avatars_web_prefix,
        }
        
        prefix = web_prefix_map.get(subdir.lower())
        if not prefix:
            raise ValueError(f"不支持的子目录：{subdir}")
        
        return f"{prefix}/{filename}"
    
    def get_image_web_url(self, filename: str) -> str:
        """
        获取图片的 Web URL
        
        Args:
            filename: 文件名
            
        Returns:
            str: 完整的 Web URL
        """
        return f"{self.images_web_prefix}/{filename}"
    
    def get_preview_web_url(self, filename: str) -> str:
        """
        获取预览图的 Web URL
        
        Args:
            filename: 文件名
            
        Returns:
            str: 完整的 Web URL
        """
        return f"{self.previews_web_prefix}/{filename}"
    
    def get_file_web_url(self, filename: str) -> str:
        """
        获取文件的 Web URL
        
        Args:
            filename: 文件名
            
        Returns:
            str: 完整的 Web URL
        """
        return f"{self.files_web_prefix}/{filename}"
    
    def get_avatar_web_url(self, filename: str) -> str:
        """
        获取头像的 Web URL
        
        Args:
            filename: 文件名
            
        Returns:
            str: 完整的 Web URL
        """
        return f"{self.avatars_web_prefix}/{filename}"


# 创建全局单例实例
upload_paths = UploadPathConfig()


# ========== 便捷函数（为了向后兼容和简化调用） ==========

def get_images_upload_dir() -> Path:
    """获取图片上传目录"""
    return upload_paths.get_images_upload_dir()


def get_previews_upload_dir() -> Path:
    """获取预览图上传目录"""
    return upload_paths.get_previews_upload_dir()


def get_files_upload_dir() -> Path:
    """获取文件上传目录"""
    return upload_paths.get_files_upload_dir()


def get_avatars_upload_dir() -> Path:
    """获取头像上传目录"""
    return upload_paths.get_avatars_upload_dir()


def build_image_save_path(filename: str) -> Path:
    """构建图片保存路径"""
    return upload_paths.build_image_save_path(filename)


def build_preview_save_path(filename: str) -> Path:
    """构建预览图保存路径"""
    return upload_paths.build_preview_save_path(filename)


def build_file_save_path(filename: str) -> Path:
    """构建文件保存路径"""
    return upload_paths.build_file_save_path(filename)


def build_avatar_save_path(filename: str) -> Path:
    """构建头像保存路径"""
    return upload_paths.build_avatar_save_path(filename)


def to_image_web_url(filename: str) -> str:
    """获取图片 Web URL"""
    return upload_paths.get_image_web_url(filename)


def to_preview_web_url(filename: str) -> str:
    """获取预览图 Web URL"""
    return upload_paths.get_preview_web_url(filename)


def to_file_web_url(filename: str) -> str:
    """获取文件 Web URL"""
    return upload_paths.get_file_web_url(filename)


def to_avatar_web_url(filename: str) -> str:
    """获取头像 Web URL"""
    return upload_paths.get_avatar_web_url(filename)
