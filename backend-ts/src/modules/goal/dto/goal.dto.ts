import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DEFAULT_MAX_GOAL_ROUNDS, MAX_GOAL_OBJECTIVE_CHARS } from '../goal.types';

/** 设定/替换会话目标 */
export class SetGoalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_GOAL_OBJECTIVE_CHARS)
  objective!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRounds?: number = DEFAULT_MAX_GOAL_ROUNDS;

  /** 期望的当前逻辑版本号（CAS）；不传则不做 CAS 校验 */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}

/** 暂停/恢复/清除目标 */
export class GoalMutationDto {
  /** 期望的当前逻辑版本号（CAS） */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
