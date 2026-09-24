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
  @IsIn(["independent", "merged"])
  outputMode?: "independent" | "merged";

  @IsString()
  @IsOptional()
  targetSessionId?: string | null;

  @IsString()
  @IsOptional()
  agentId?: string | null;

  @IsString()
  @IsOptional()
  modelId?: string | null;

  @IsObject()
  @IsOptional()
  settings?: Record<string, any> | null;

  @IsString()
  @IsOptional()
  workspacePath?: string | null;

  @IsObject()
  @IsOptional()
  attachments?: Record<string, string[]> | null;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  expiresAt?: string | null;

  @IsBoolean()
  @IsOptional()
  unattended?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  maxRetries?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  retryInterval?: number;
}
