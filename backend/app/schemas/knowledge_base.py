"""
知识库 API Schema 定义

提供请求/响应数据的 Pydantic 模型验证
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
from app.schemas.base import BaseResponse


# ============ 知识库相关 Schema ============

class KnowledgeBaseCreate(BaseModel):
    """创建知识库请求"""
    name: str = Field(..., min_length=1, max_length=255, description="知识库名称")
    description: Optional[str] = Field(None, max_length=2000, description="知识库描述")
    embedding_model_id: str = Field(..., description="向量模型 ID（关联 model 表）")
    chunk_max_size: int = Field(default=1000, ge=100, le=5000, description="最大分块大小")
    chunk_overlap_size: int = Field(default=100, ge=0, le=500, description="分块重叠大小")
    chunk_min_size: int = Field(default=50, ge=10, le=500, description="最小分块大小")
    is_public: bool = Field(default=False, description="是否公开")
    metadata_config: Optional[Dict[str, Any]] = Field(None, description="额外配置")


class KnowledgeBaseUpdate(BaseModel):
    """更新知识库请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    embedding_model_id: Optional[str] = Field(None, description="向量模型 ID")
    chunk_max_size: Optional[int] = Field(None, ge=100, le=5000)
    chunk_overlap_size: Optional[int] = Field(None, ge=0, le=500)
    chunk_min_size: Optional[int] = Field(None, ge=10, le=500)
    is_public: Optional[bool] = Field(None)
    metadata_config: Optional[Dict[str, Any]] = Field(None)


class KnowledgeBaseResponse(BaseResponse):
    """知识库响应"""
    id: str
    name: str
    description: Optional[str]
    user_id: str
    embedding_model_id: str
    chunk_max_size: int
    chunk_overlap_size: int
    chunk_min_size: int
    is_active: bool
    is_public: bool
    metadata_config: Optional[Dict[str, Any]]
    
    model_config = {"from_attributes": True}


class KnowledgeBaseListResponse(BaseModel):
    """知识库列表响应"""
    items: List[KnowledgeBaseResponse]
    total: int
    skip: int
    limit: int


# ============ 文件相关 Schema ============

class KBFileUploadResponse(BaseResponse):
    """文件上传响应"""
    id: str
    file_name: str
    display_name: str
    file_size: int
    file_type: str
    file_extension: str
    processing_status: str
    progress_percentage: int
    current_step: Optional[str]
    
    model_config = {"from_attributes": True}


class KBFileResponse(BaseResponse):
    """文件详情响应"""
    id: str
    knowledge_base_id: str
    file_name: str
    display_name: str
    file_size: int
    file_type: str
    file_extension: str
    content_hash: str
    processing_status: str
    progress_percentage: int
    current_step: Optional[str]
    error_message: Optional[str]
    total_chunks: int
    total_tokens: int
    
    model_config = {"from_attributes": True}


class KBFileListResponse(BaseModel):
    """文件列表响应"""
    items: List[KBFileResponse]
    total: int
    skip: int
    limit: int


class FileProcessingStatusResponse(BaseResponse):
    """文件处理状态响应"""
    id: str
    file_name: str
    processing_status: str
    progress_percentage: int
    current_step: Optional[str]
    error_message: Optional[str]
    total_chunks: int
    
    model_config = {"from_attributes": True}


# ============ 分块相关 Schema ============

class KBChunkResponse(BaseResponse):
    """分块响应"""
    id: str
    file_id: str
    knowledge_base_id: str
    content: str
    chunk_index: int
    vector_id: Optional[str]
    embedding_dimensions: Optional[int]
    token_count: int
    metadata: Optional[Dict[str, Any]]
    
    model_config = {"from_attributes": True}


class KBChunkListResponse(BaseModel):
    """分块列表响应"""
    items: List[KBChunkResponse]
    total: int
    skip: int
    limit: int


# ============ 搜索相关 Schema ============

class KnowledgeSearchRequest(BaseModel):
    """知识库搜索请求"""
    query: str = Field(..., min_length=1, max_length=2000, description="查询文本")
    top_k: int = Field(default=5, ge=1, le=20, description="返回结果数量")
    filter_file_id: Optional[str] = Field(None, description="按文件 ID 过滤")
    
    # 混合搜索参数
    use_hybrid_search: bool = Field(default=True, description="是否使用混合搜索")
    semantic_weight: float = Field(default=0.6, ge=0.0, le=1.0, description="语义权重")
    keyword_weight: float = Field(default=0.4, ge=0.0, le=1.0, description="关键词权重")


class SearchChunkResponse(BaseModel):
    """搜索分块结果"""
    content: str
    metadata: Dict[str, Any]
    similarity: float  # 兼容旧版，纯语义搜索时使用
    file_name: Optional[str] = None
    
    # 混合搜索分数字段（可选）
    semantic_score: Optional[float] = Field(None, description="语义分数")
    keyword_score: Optional[float] = Field(None, description="关键词分数")
    final_score: Optional[float] = Field(None, description="综合分数")


class KnowledgeSearchResponse(BaseModel):
    """搜索结果响应"""
    query: str
    results: List[SearchChunkResponse]
    total: int


# ============ 通用响应 Schema ============

class MessageResponse(BaseModel):
    """通用消息响应"""
    message: str
    success: bool = True


class ErrorResponse(BaseModel):
    """错误响应"""
    error: str
    detail: Optional[str] = None
    code: str = "ERROR"
