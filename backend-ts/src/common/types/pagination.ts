/**
 * 通用分页响应类型
 * 
 * 用于统一所有列表接口的返回格式，与 Python 后端的 PaginatedResponse 保持一致
 */
export interface PaginatedResponse<T> {
    /** 数据列表 */
    items: T[];
    /** 总记录数 */
    total: number;
    /** 当前页码（可选） */
    page?: number;
    /** 每页大小（可选） */
    size?: number;
    /** 跳过的记录数（可选，用于 offset 分页） */
    skip?: number;
    /** 限制返回的记录数（可选） */
    limit?: number;
}

/**
 * 创建分页响应的辅助函数
 */
export function createPaginatedResponse<T>(
    items: T[],
    total: number,
    options?: {
        page?: number;
        size?: number;
        skip?: number;
        limit?: number;
    },
): PaginatedResponse<T> {
    return {
        items,
        total,
        ...options,
    };
}
