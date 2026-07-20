import { IsOptional, IsString, IsBoolean, IsObject, IsNumber, ValidateNested, IsArray } from "class-validator";
import { Type } from "class-transformer";

/**
 * 记忆配置
 */
class MemorySettingsDto {
  @IsOptional()
  @IsNumber()
  compressionTriggerRatio?: number;

  @IsOptional()
  @IsNumber()
  compressionTargetRatio?: number;

  @IsOptional()
  @IsString()
  summaryMode?: string;

  @IsOptional()
  @IsNumber()
  maxTokensLimit?: number;
}

/**
 * 模型参数覆盖
 */
class ModelSettingsDto {
  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsNumber()
  topP?: number;

  @IsOptional()
  @IsNumber()
  frequencyPenalty?: number;
}

/**
 * 会话设置 DTO
 *
 * 显式声明所有允许写入的 settings 字段，配合 ValidationPipe({ whitelist: true })
 * 自动剔除未声明的字段，替代 service 层的手工 whitelist 过滤。
 */
export class SessionSettingsDto {
  @IsOptional()
  @IsString()
  thinkingEffort?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referencedKbs?: string[];

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsBoolean()
  memoryEnabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => MemorySettingsDto)
  memory?: MemorySettingsDto;

  @IsOptional()
  @IsBoolean()
  modelOverrideEnabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModelSettingsDto)
  model?: ModelSettingsDto;

  @IsOptional()
  @IsString()
  runMode?: string; // "normal" | "plan"
}
