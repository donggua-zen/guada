import { IsOptional, IsString, ValidateNested } from "class-validator";
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
  characterId?: string;

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
}
