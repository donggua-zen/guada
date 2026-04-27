import { CreateBotDto } from './create-bot.dto';

// 简化版 PartialType,所有字段设为可选
export class UpdateBotDto {
  id?: string;
  platform?: 'qq' | 'wechat' | 'discord';
  name?: string;
  credentials?: Record<string, any>;
  enabled?: boolean;
  reconnectConfig?: {
    enabled: boolean;
    maxRetries: number;
    retryInterval: number;
  };
  defaultCharacterId?: string;
  defaultModelId?: string;
}
