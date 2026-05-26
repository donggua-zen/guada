import { IsString, IsOptional, IsBoolean, IsIn, IsObject, IsInt, Min } from "class-validator";

/**
 * 更新定时任务请求 DTO
 */
export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  prompt?: string;

  @IsString()
  @IsOptional()
  @IsIn(["cron", "once"])
  scheduleType?: "cron" | "once";

  @IsString()
  @IsOptional()
  cronExpression?: string;

  @IsString()
  @IsOptional()
  executeAt?: string | null;

  @IsString()
  @IsOptional()
  @IsIn(["new_session", "existing_session"])
  targetMode?: "new_session" | "existing_session";

  @IsString()
  @IsOptional()
  targetSessionId?: string | null;

  @IsString()
  @IsOptional()
  characterId?: string | null;

  @IsString()
  @IsOptional()
  modelId?: string | null;

  @IsObject()
  @IsOptional()
  settings?: Record<string, any> | null;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxExecutions?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  maxRetries?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  retryInterval?: number;
}
