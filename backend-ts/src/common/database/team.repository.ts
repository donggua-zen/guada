import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Injectable()
export class TeamRepository {
  constructor(private prisma: PrismaService) {}

  async findById(id: string, includeRelations: boolean = true) {
    if (includeRelations) {
      return this.prisma.team.findUnique({
        where: { id },
        include: {
          leader: true,
          members: {
            orderBy: { sortOrder: "asc" as const },
            include: { character: true },
          },
          user: { select: { nickname: true } },
        },
      });
    }
    return this.prisma.team.findUnique({
      where: { id },
    });
  }

  async findByUserId(
    userId: string,
    skip: number = 0,
    limit: number = 20,
  ) {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          leader: true,
          members: {
            orderBy: { sortOrder: "asc" },
            include: { character: true },
          },
        },
      }),
      this.prisma.team.count({ where }),
    ]);
    return { items, total };
  }

  async create(data: any) {
    return this.prisma.team.create({
      data,
      include: {
        leader: true,
        members: { include: { character: true } },
      },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.team.update({
      where: { id },
      data,
      include: {
        leader: true,
        members: { include: { character: true } },
      },
    });
  }

  async delete(id: string) {
    return this.prisma.team.delete({
      where: { id },
    });
  }
}

@Injectable()
export class TeamMemberRepository {
  constructor(private prisma: PrismaService) {}

  async findByTeamId(teamId: string) {
    return this.prisma.teamMember.findMany({
      where: { teamId },
      orderBy: { sortOrder: "asc" },
      include: { character: true },
    });
  }

  async findByTeamIdAndCharacterId(teamId: string, characterId: string) {
    return this.prisma.teamMember.findUnique({
      where: { teamId_characterId: { teamId, characterId } },
    });
  }

  async create(data: any) {
    return this.prisma.teamMember.create({ data });
  }

  async createMany(data: any[]) {
    return this.prisma.teamMember.createMany({ data });
  }

  async deleteByTeamId(teamId: string) {
    return this.prisma.teamMember.deleteMany({
      where: { teamId },
    });
  }

  async deleteByTeamIdAndCharacterId(teamId: string, characterId: string) {
    return this.prisma.teamMember.delete({
      where: { teamId_characterId: { teamId, characterId } },
    });
  }
}
