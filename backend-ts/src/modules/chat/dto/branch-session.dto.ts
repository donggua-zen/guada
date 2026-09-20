import { IsOptional, IsString } from "class-validator";

/**
 * 分支会话请求 DTO
 *
 * 以指定回合（助手消息所在回合）为节点，完整复制源会话为新会话。
 * turnId 必须对应一个已完成回合（存在 turn/finish），否则后端 400。
 */
export class BranchSessionDto {
  /** 分支锚点回合 id（助手消息所在回合） */
  @IsString()
  turnId!: string;

  /** 新会话标题；缺省为「原标题 (fork)」 */
  @IsOptional()
  @IsString()
  title?: string;
}
