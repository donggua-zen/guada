import { IsOptional, IsString, IsBoolean, IsNumber, IsIn, ValidateNested, IsArray } from "class-validator";
import { Type } from "class-transformer";

/**
 * 记忆配置（压缩档位；与后端 compression-tiers.ts 的 CompressionTier 值一致。
 * 注意：运行时压缩配置取自角色 settings.memory，会话级 memory 不参与合并——
 * 此 DTO 仅作为会话设置写入的声明式契约）
 */
class MemorySettingsDto {
  @IsOptional()
  @IsIn(["off", "conservative", "aggressive"])
  compressionTier?: string;
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
  @IsIn(["read-only", "workspace-write", "danger-full-access"])
  sandboxMode?: string; // 三档安全模式（对齐 DSH SandboxMode）

  @IsOptional()
  @IsNumber()
  maxTokensLimit?: number; // 会话级别 Token 上限，独立于角色 memory 配置

  @IsOptional()
  attachments?: Record<string, string[]>; // 会话绑定的附件，key=附件类型ID，value=附件项ID列表
}
