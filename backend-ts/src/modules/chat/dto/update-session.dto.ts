import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionSettingsDto } from './session-settings.dto';

/**
 * 更新会话配置请求 DTO
 * 限制可更新字段，防止非法值写入
 * settings 字段使用 SessionSettingsDto 显式声明允许的字段，
 * 配合 ValidationPipe({ whitelist: true }) 自动剔除未声明的键。
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
   * 分组 ID
   */
  @IsOptional()
  @IsString()
  groupId?: string;

  /**
   * 会话设置
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => SessionSettingsDto)
  settings?: SessionSettingsDto;
}
