import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

@Injectable()
export class GlobalSettingRepository {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.globalSetting.findMany();
  }

  async findByKey(key: string) {
    return this.prisma.globalSetting.findUnique({ where: { key } });
  }

  async upsert(data: { key: string; value: any }) {
    return this.prisma.globalSetting.upsert({
      where: { key: data.key },
      update: { value: data.value },
      create: data,
    });
  }

  async saveBatch(settings: Array<{ key: string; value: any }>) {
    const transaction = settings.map((item) =>
      this.prisma.globalSetting.upsert({
        where: { key: item.key },
        update: { value: item.value },
        create: item,
      }),
    );
    return this.prisma.$transaction(transaction);
  }
}
