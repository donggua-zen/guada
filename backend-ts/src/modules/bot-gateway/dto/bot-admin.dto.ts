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
  defaultCharacterId: string;   // 默认角色ID（动态读取，修改后无需重启）
  defaultModelId?: string;      // 默认模型ID（动态读取，修改后无需重启）
  additionalKwargs?: any;       // 扩展配置（如 knowledgeBaseIds，动态读取，修改后无需重启）
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
  defaultCharacterId?: string;  // 默认角色ID（动态读取，修改后无需重启）
  defaultModelId?: string;      // 默认模型ID（动态读取，修改后无需重启）
  additionalKwargs?: any;       // 扩展配置（如 knowledgeBaseIds，动态读取，修改后无需重启）
}
