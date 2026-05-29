import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class CreateBotDto {
  @IsString()
  id: string;

  @IsString()
  platform: 'qq' | 'wechat' | 'discord' | 'lark' | 'wecom' | 'wechat-personal';

  @IsString()
  name: string;

  @IsObject()
  credentials: Record<string, any>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsObject()
  @IsOptional()
  reconnectConfig?: {
    enabled: boolean;
    maxRetries: number;
    retryInterval: number;
  };

  @IsString()
  @IsOptional()
  defaultCharacterId?: string;

  @IsString()
  @IsOptional()
  defaultModelId?: string;
}
