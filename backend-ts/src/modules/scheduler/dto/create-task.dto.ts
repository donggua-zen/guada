import { IsString, IsOptional, IsBoolean, IsIn, IsObject, IsInt, Min } from "class-validator";

/**
 * 创建定时任务请求 DTO
 */
export class CreateTaskDto {
  @IsString()
  name: string;

  @IsString()
  prompt: string;

  @IsString()
  @IsIn(["cron", "once"])
  scheduleType: "cron" | "once";

  @IsString()
  @IsOptional()
  cronExpression?: string;

  @IsString()
  @IsOptional()
  executeAt?: string;

  @IsString()
  @IsIn(["new_session", "existing_session"])
  targetMode: "new_session" | "existing_session";

  @IsString()
  @IsOptional()
  @IsIn(["independent", "merged"])
  outputMode?: "independent" | "merged";

  @IsString()
  @IsOptional()
  targetSessionId?: string;

  @IsString()
  @IsOptional()
  agentId?: string;

  @IsString()
  @IsOptional()
  modelId?: string;

  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;

  @IsString()
  @IsOptional()
  workspacePath?: string;

  @IsObject()
  @IsOptional()
  attachments?: Record<string, string[]>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  expiresAt?: string;

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
