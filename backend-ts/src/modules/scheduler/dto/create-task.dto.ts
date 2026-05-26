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
  targetSessionId?: string;

  @IsString()
  @IsOptional()
  characterId?: string;

  @IsString()
  @IsOptional()
  modelId?: string;

  @IsObject()
  @IsOptional()
  settings?: Record<string, any>;

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
