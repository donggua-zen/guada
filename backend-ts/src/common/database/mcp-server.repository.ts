import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service';

@Injectable()
export class McpServerRepository {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.mcpServer.findMany({ 
      where: { userId },
      orderBy: { createdAt: 'desc' } 
    });
  }

  async findById(id: string, userId?: string) {
    return this.prisma.mcpServer.findUnique({ 
      where: { 
        id,
        ...(userId ? { userId } : {})
      } 
    });
  }

  async create(data: any) {
    return this.prisma.mcpServer.create({ data });
  }

  async update(id: string, data: any, userId?: string) {
    return this.prisma.mcpServer.update({ 
      where: { 
        id,
        ...(userId ? { userId } : {})
      }, 
      data 
    });
  }

  async delete(id: string, userId?: string) {
    return this.prisma.mcpServer.delete({ 
      where: { 
        id,
        ...(userId ? { userId } : {})
      } 
    });
  }

  async updateTools(id: string, tools: any[] | Record<string, any>) {
    // 支持数组和字典两种格式
    const toolsData = tools;
    return this.prisma.mcpServer.update({
      where: { id },
      data: { tools: toolsData },
    });
  }
}
