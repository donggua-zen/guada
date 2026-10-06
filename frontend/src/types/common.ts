/**
 * 通用类型定义
 */

/**
 * API 响应基础接口
 */
export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
  success?: boolean
}

/**
 * 分页响应数据
 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasNext: boolean
  hasPrev: boolean
  /** 游标:历史快照最后一条已入库事件的 seq(messages 端点返回,订阅增量去重用) */
  lastSeq?: number
}

/**
 * 时间戳字符串（ISO 8601 格式）
 */
export type ISODateString = string

/**
 * 可选的任意值（以显式 null 代替宽松的隐式类型）
 */
export type Nullable<T> = T | null

/**
 * 部分必填，部分可选
 */
export type PartialRequired<T, K extends keyof T> = Partial<T> & Pick<T, K>

/**
 * 深度部分化
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * 只读深度版本
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P]
}
