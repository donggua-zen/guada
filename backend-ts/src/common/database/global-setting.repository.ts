import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";

@Injectable()
export class GlobalSettingRepository {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.globalSetting.findMany({
      where: { OR: [{ userId }, { userId: null }] },
    });
  }

  async findByKey(key: string, userId: string) {
    // 优先查找用户专属设置，如果没有则查找全局默认设置（userId 为 null）
    const userSetting = await this.prisma.globalSetting.findFirst({
      where: { key, userId },
    });
    if (userSetting) return userSetting;

    return this.prisma.globalSetting.findFirst({
      where: { key, userId: null },
    });
  }

  async upsert(data: { key: string; value: any; userId?: string | null }) {
    // 将值序列化为 JSON 字符串
    const serializedValue = typeof data.value === 'object' 
      ? JSON.stringify(data.value) 
      : String(data.value ?? '');
    
    return this.prisma.globalSetting.upsert({
      where: {
        key_userId: {
          key: data.key,
          userId: data.userId || null,
        },
      },
      update: { value: serializedValue },
      create: { 
        key: data.key, 
        value: serializedValue, 
        userId: data.userId || null 
      },
    });
  }

  async saveBatch(
    settings: Array<{ key: string; value: any; userId?: string | null }>,
  ) {
    const transaction = settings.map((item) => {
      // 将值序列化为 JSON 字符串
      const serializedValue = typeof item.value === 'object' 
        ? JSON.stringify(item.value) 
        : String(item.value ?? '');
      
      return this.prisma.globalSetting.upsert({
        where: {
          key_userId: {
            key: item.key,
            userId: item.userId || null,
          },
        },
        update: { value: serializedValue },
        create: { 
          key: item.key, 
          value: serializedValue, 
          userId: item.userId || null 
        },
      });
    });
    return this.prisma.$transaction(transaction);
  }
}
