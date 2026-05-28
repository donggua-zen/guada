import { IsOptional, IsString, IsObject } from 'class-validator';

/**
 * 更新会话配置请求 DTO
 * 限制可更新字段，防止非法值写入
 * 注意：工作目录路径不允许通过此接口更新，请使用 PUT /sessions/:id/workspace-path
 */
export class UpdateSessionDto {
  /**
   * 会话标题
   */
  @IsOptional()
  @IsString()
  title?: string;

  /**
   * 使用的模型 ID
   */
  @IsOptional()
  @IsString()
  modelId?: string;

  /**
   * 会话设置
   */
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}
