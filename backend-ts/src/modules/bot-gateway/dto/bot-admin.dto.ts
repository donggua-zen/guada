/**
 * 创建机器人实例 DTO
 */
export class CreateBotDto {
  platform: string;           // 平台类型
  name: string;               // 机器人名称
  platformConfig: any;        // 平台特定配置(包含认证信息等)
  reconnectConfig?: {
    enabled?: boolean;
    maxRetries?: number;
    retryInterval?: number;
  };
  defaultCharacterId: string;   // 默认关联的角色ID(必填)
  defaultModelId?: string;
  additionalKwargs?: any;       // 扩展配置(如 knowledgeBaseIds)
  autoStart?: boolean;        // 是否自动启动
}

/**
 * 更新机器人实例 DTO
 */
export class UpdateBotDto {
  name?: string;
  platformConfig?: any;       // 平台特定配置
  enabled?: boolean;
  reconnectConfig?: {
    enabled?: boolean;
    maxRetries?: number;
    retryInterval?: number;
  };
  defaultCharacterId?: string;  // 更新时可选
  defaultModelId?: string;
  additionalKwargs?: any;       // 扩展配置(如 knowledgeBaseIds)
}
