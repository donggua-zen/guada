/**
 * 公共类型定义索引
 * 
 * 集中导出所有通用类型，方便其他模块引用
 */

// 分页相关类型
export { PaginatedResponse, createPaginatedResponse } from './pagination';

// LLM 交互相关类型
export { MessagePart, ToolCallItem, MessageRecord } from './message.types';
