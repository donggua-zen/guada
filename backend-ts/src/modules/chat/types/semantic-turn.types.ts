/**
 * 语义轮次接口定义
 * 
 * 语义轮次 = 从用户消息开始,到助手给出最终非工具调用的回复为止
 * 期间的所有工具交互视为该轮次的内部状态
 */
export interface SemanticTurn {
  /** 轮次起始索引(在消息数组中的位置) */
  startIndex: number;
  
  /** 轮次结束索引(在消息数组中的位置) */
  endIndex: number;
  
  /** 该轮次是否包含工具调用 */
  hasToolCalls: boolean;
  
  /** 用户消息的索引位置 */
  userMessageIndex: number;
  
  /** 轮次内的消息数量 */
  messageCount?: number;
}
