import { IsString, IsNotEmpty, IsOptional, IsObject, IsBoolean, IsNumber, ValidateNested } from 'class-validator';
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
  defaultCharacterId: string;

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
  defaultCharacterId?: string;

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
