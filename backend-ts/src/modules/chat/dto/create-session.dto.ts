import { IsOptional, IsString, IsObject, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { SessionSettingsDto } from "./session-settings.dto";

/**
 * 创建会话请求 DTO
 *
 * settings 通过 SessionSettingsDto 声明允许字段，
 * 配合全局 ValidationPipe({ whitelist: true }) 自动剔除未声明字段。
 */
export class CreateSessionDto {
  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  workspacePath?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SessionSettingsDto)
  settings?: SessionSettingsDto;

  /** 通用扩展字段（不索引）：导入来源等（SessionRow.data），整对象透传不校验内部键 */
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}
