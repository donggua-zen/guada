import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service";

@Injectable()
export class CharacterGroupRepository {
  constructor(private prisma: PrismaService) { }

  async findByUserId(userId: string) {
    return this.prisma.characterGroup.findMany({
      where: { userId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async findById(id: string) {
    return this.prisma.characterGroup.findUnique({
      where: { id },
    });
  }

  async create(data: any) {
    return this.prisma.characterGroup.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.characterGroup.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.characterGroup.delete({
      where: { id },
    });
  }
}
