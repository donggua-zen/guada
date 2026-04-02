"""
文件解析服务

负责解析各种格式的文件并提取文本内容
支持：纯文本、Markdown、代码文件、PDF、Word 文档等
"""

import io
import logging
from pathlib import Path
from typing import Optional, Set
import aiofiles
import pdfplumber
from docx import Document

logger = logging.getLogger(__name__)


class FileParserService:
    """文件解析服务"""

    # 文件类型定义
    TEXT_EXTENSIONS: Set[str] = {
        "txt", "md", "markdown",  # 纯文本和 Markdown
        "py", "js", "ts", "jsx", "tsx",  # 代码文件
        "java", "cpp", "c", "h", "hpp",  # C/C++/Java
        "go", "rs", "rb", "php",  # 其他语言
        "json", "xml", "yaml", "yml", "toml",  # 配置文件
        "html", "htm", "css", "scss", "less",  # Web 文件
        "csv", "tsv",  # 数据文件
        "sql", "sh", "bat", "ps1",  # 脚本文件
    }
    
    PDF_EXTENSIONS: Set[str] = {"pdf"}
    WORD_EXTENSIONS: Set[str] = {"docx"}
    
    # 文件大小限制（字节）
    MAX_TEXT_SIZE: int = 10 * 1024 * 1024  # 10MB
    MAX_PDF_SIZE: int = 50 * 1024 * 1024  # 50MB
    MAX_WORD_SIZE: int = 20 * 1024 * 1024  # 20MB

    def __init__(self):
        """初始化文件解析服务"""
        pass

    async def detect_file_type(self, file_extension: str) -> str:
        """
        检测文件类型
        
        Args:
            file_extension: 文件扩展名（不含点，如 "pdf"）
        
        Returns:
            str: 文件类型（text, pdf, word, code, unknown）
        """
        ext = file_extension.lower().lstrip(".")
        
        if ext in self.TEXT_EXTENSIONS:
            return "text"
        elif ext in self.PDF_EXTENSIONS:
            return "pdf"
        elif ext in self.WORD_EXTENSIONS:
            return "word"
        elif ext in {"py", "js", "ts", "java", "cpp", "c", "go", "rs"}:
            return "code"
        else:
            return "unknown"

    async def parse_file(
        self,
        file_content: bytes,
        file_type: str,
        file_extension: str,
        file_size: Optional[int] = None,
    ) -> str:
        """
        解析文件内容
        
        Args:
            file_content: 文件内容（bytes）
            file_type: 文件类型（text/pdf/word/code）
            file_extension: 文件扩展名
            file_size: 文件大小（字节）
        
        Returns:
            str: 解析后的文本内容
        
        Raises:
            ValueError: 不支持的文件类型
            RuntimeError: 解析失败
        """
        ext = file_extension.lower().lstrip(".")
        
        # 验证文件大小
        if file_size:
            await self._validate_file_size(file_size, file_type)
        
        try:
            if file_type == "text" or file_type == "code":
                return await self._parse_text_file(file_content, ext)
            elif file_type == "pdf":
                return await self._parse_pdf_file(file_content)
            elif file_type == "word":
                return await self._parse_word_file(file_content)
            else:
                # 未知类型，尝试当作文本解析
                logger.warning(f"未知文件类型：{file_type}，尝试当作文本解析")
                return await self._parse_text_file(file_content, ext)
                
        except Exception as e:
            logger.error(f"文件解析失败：{file_extension}, size={file_size}, error={e}")
            raise RuntimeError(f"文件解析失败：{str(e)}")

    async def _validate_file_size(self, file_size: int, file_type: str) -> None:
        """验证文件大小"""
        limits = {
            "text": self.MAX_TEXT_SIZE,
            "code": self.MAX_TEXT_SIZE,
            "pdf": self.MAX_PDF_SIZE,
            "word": self.MAX_WORD_SIZE,
        }
        
        limit = limits.get(file_type, self.MAX_TEXT_SIZE)
        if file_size > limit:
            raise ValueError(f"文件超出大小限制（最大 {limit // 1024 // 1024}MB）")

    async def _parse_text_file(self, content: bytes, ext: str) -> str:
        """
        解析文本文件
        
        Args:
            content: 文件内容
            ext: 文件扩展名
        
        Returns:
            str: 文本内容
        """
        # 尝试不同的编码
        encodings = ["utf-8", "gbk", "gb2312", "latin-1"]
        
        for encoding in encodings:
            try:
                text = content.decode(encoding)
                # 清理空白字符，但保留原有结构
                return text.strip()
            except UnicodeDecodeError:
                continue
        
        # 如果所有编码都失败，使用 latin-1（不会抛出异常）
        return content.decode("latin-1", errors="replace").strip()

    async def _parse_pdf_file(self, content: bytes) -> str:
        """
        解析 PDF 文件
        
        Args:
            content: PDF 文件内容
        
        Returns:
            str: 提取的文本内容
        """
        text_parts = []
        
        try:
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_parts.append(page_text)
            
            return "\n\n".join(text_parts).strip()
            
        except Exception as e:
            logger.error(f"PDF 解析失败：{e}")
            raise RuntimeError(f"PDF 文件解析失败：{str(e)}")

    async def _parse_word_file(self, content: bytes) -> str:
        """
        解析 Word 文档（.docx）
        
        Args:
            content: Word 文件内容
        
        Returns:
            str: 提取的文本内容
        """
        try:
            doc = Document(io.BytesIO(content))
            paragraphs = [para.text.strip() for para in doc.paragraphs if para.text.strip()]
            return "\n\n".join(paragraphs)
            
        except Exception as e:
            logger.error(f"Word 文档解析失败：{e}")
            raise RuntimeError(f"Word 文档解析失败：{str(e)}")

    async def parse_file_from_path(self, file_path: str) -> str:
        """
        从文件路径解析内容
        
        Args:
            file_path: 文件路径
        
        Returns:
            str: 解析后的文本内容
        """
        path = Path(file_path)
        ext = path.suffix.lstrip(".").lower()
        file_type = await self.detect_file_type(ext)
        
        async with aiofiles.open(file_path, "rb") as f:
            content = await f.read()
        
        return await self.parse_file(
            file_content=content,
            file_type=file_type,
            file_extension=ext,
            file_size=len(content),
        )

    def get_supported_extensions(self) -> dict:
        """
        获取支持的文件扩展名列表
        
        Returns:
            dict: {文件类型：[扩展名列表]}
        """
        return {
            "text": sorted(list(self.TEXT_EXTENSIONS)),
            "pdf": sorted(list(self.PDF_EXTENSIONS)),
            "word": sorted(list(self.WORD_EXTENSIONS)),
            "code": ["py", "js", "ts", "java", "cpp", "c", "go", "rs"],
        }
