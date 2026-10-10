import { IsString, IsNotEmpty, IsOptional, IsObject, IsBoolean, IsNumber, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';

class ReconnectConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  maxRetries?: number;

  @IsOptional()
  @IsNumber()
  retryInterval?: number;
}

/**
 * 创建机器人实例 DTO
 */
export class CreateBotDto {
  @IsString()
  @IsNotEmpty()
  platform: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsObject()
  platformConfig: any;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReconnectConfigDto)
  reconnectConfig?: ReconnectConfigDto;

  @IsString()
  @IsNotEmpty()
  defaultAgentId: string;

  @IsOptional()
  @IsString()
  defaultModelId?: string;

  @IsOptional()
  @IsString()
  defaultThinkingEffort?: string;

  @IsOptional()
  @IsObject()
  additionalKwargs?: any;

  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;
}

/**
 * 更新机器人实例 DTO
 */
export class UpdateBotDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  platformConfig?: any;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReconnectConfigDto)
  reconnectConfig?: ReconnectConfigDto;

  @IsOptional()
  @IsString()
  defaultAgentId?: string;

  @IsOptional()
  @IsString()
  defaultModelId?: string;

  @IsOptional()
  @IsString()
  defaultThinkingEffort?: string;

  @IsOptional()
  @IsObject()
  additionalKwargs?: any;
}

/**
 * 提交扫码登录的数字配对码（微信个人号等平台）
 */
export class SubmitBotVerificationDto {
  @IsString()
  @Matches(/^\d{4,8}$/, { message: '数字配对码必须是 4 至 8 位数字' })
  code: string;
}
