import { Injectable, Logger } from "@nestjs/common";
import { TeamRepository, TeamMemberRepository } from "../../common/database/team.repository";
import { CharacterRepository } from "../../common/database/character.repository";
import { UrlService } from "../../common/services/url.service";

/**
 * 角色摘要结构（存入 TeamMember.characterSnapshot）
 */
interface CharacterSnapshot {
  title: string;
  description?: string;
  avatarUrl?: string;
}

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private teamRepo: TeamRepository,
    private teamMemberRepo: TeamMemberRepository,
    private characterRepo: CharacterRepository,
    private urlService: UrlService,
  ) {}

  // --- Team CRUD ---

  async getTeams(userId: string, skip = 0, limit = 20) {
    const result = await this.teamRepo.findByUserId(userId, skip, limit);
    return {
      ...result,
      items: (result.items || []).map((item: any) => this.transformTeamUrls(item)),
    };
  }

  async getTeamById(id: string) {
    const team = await this.teamRepo.findById(id);
    if (!team) {
      throw new Error("团队不存在");
    }
    return this.transformTeamUrls(team);
  }

  async createTeam(
    userId: string,
    data: {
      name: string;
      description?: string;
      avatarUrl?: string;
      leaderCharacterId: string;
      memberCharacterIds?: string[];
      settings?: any;
    },
  ) {
    // 验证主理人角色存在
    const leader = await this.characterRepo.findById(data.leaderCharacterId);
    if (!leader) {
      throw new Error("主理人角色不存在");
    }

    // 创建团队
    const team = await this.teamRepo.create({
      userId,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatarUrl,
      leaderCharacterId: data.leaderCharacterId,
      settings: data.settings || {},
    });

    // 自动将主理人加入成员列表
    const members: { teamId: string; characterId: string; role: string; sortOrder: number; characterSnapshot: any }[] = [
      {
        teamId: team.id,
        characterId: data.leaderCharacterId,
        role: "leader",
        sortOrder: 0,
        characterSnapshot: this.buildCharacterSnapshot(leader),
      },
    ];

    // 添加其他成员
    if (data.memberCharacterIds && data.memberCharacterIds.length > 0) {
      for (let i = 0; i < data.memberCharacterIds.length; i++) {
        const characterId = data.memberCharacterIds[i];
        if (characterId === data.leaderCharacterId) continue; // 跳过主理人（已添加）
        const character = await this.characterRepo.findById(characterId);
        if (!character) {
          this.logger.warn(`角色 ${characterId} 不存在，跳过`);
          continue;
        }
        members.push({
          teamId: team.id,
          characterId,
          role: "member",
          sortOrder: i + 1,
          characterSnapshot: this.buildCharacterSnapshot(character),
        });
      }
    }

    await this.teamMemberRepo.createMany(members);

    const created = await this.teamRepo.findById(team.id);
    return this.transformTeamUrls(created);
  }

  async updateTeam(
    id: string,
    data: {
      name?: string;
      description?: string;
      avatarUrl?: string;
      leaderCharacterId?: string;
      settings?: any;
    },
  ) {
    const team = await this.teamRepo.findById(id);
    if (!team) {
      throw new Error("团队不存在");
    }

    // 如果更换主理人，验证新主理人角色存在
    if (data.leaderCharacterId && data.leaderCharacterId !== team.leaderCharacterId) {
      const newLeader = await this.characterRepo.findById(data.leaderCharacterId);
      if (!newLeader) {
        throw new Error("新主理人角色不存在");
      }

      // 确保新主理人在成员列表中
      const existingMember = await this.teamMemberRepo.findByTeamIdAndCharacterId(
        id,
        data.leaderCharacterId,
      );
      if (!existingMember) {
        // 自动添加为主理人
        await this.teamMemberRepo.create({
          teamId: id,
          characterId: data.leaderCharacterId,
          role: "leader",
          sortOrder: 0,
          characterSnapshot: this.buildCharacterSnapshot(newLeader),
        });
      } else {
        // 更新角色为 leader
        await this.teamMemberRepo.deleteByTeamIdAndCharacterId(id, data.leaderCharacterId);
        await this.teamMemberRepo.create({
          teamId: id,
          characterId: data.leaderCharacterId,
          role: "leader",
          sortOrder: 0,
          characterSnapshot: this.buildCharacterSnapshot(newLeader),
        });
      }

      // 旧主理人降级为 member
      const oldLeaderMember = await this.teamMemberRepo.findByTeamIdAndCharacterId(
        id,
        team.leaderCharacterId,
      );
      if (oldLeaderMember) {
        await this.teamMemberRepo.deleteByTeamIdAndCharacterId(id, team.leaderCharacterId);
        await this.teamMemberRepo.create({
          teamId: id,
          characterId: team.leaderCharacterId,
          role: "member",
          sortOrder: oldLeaderMember.sortOrder,
          characterSnapshot: oldLeaderMember.characterSnapshot,
        });
      }
    }

    const updated = await this.teamRepo.update(id, data);
    return this.transformTeamUrls(updated);
  }

  async deleteTeam(id: string) {
    const team = await this.teamRepo.findById(id);
    if (!team) {
      throw new Error("团队不存在");
    }
    // TeamMember 有 onDelete: Cascade，删除 team 时自动删除成员
    return this.teamRepo.delete(id);
  }

  // --- Member Management ---

  async addMember(teamId: string, characterId: string) {
    const team = await this.teamRepo.findById(teamId);
    if (!team) {
      throw new Error("团队不存在");
    }

    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("角色不存在");
    }

    // 检查是否已在团队中
    const existing = await this.teamMemberRepo.findByTeamIdAndCharacterId(teamId, characterId);
    if (existing) {
      throw new Error("该角色已在团队中");
    }

    // 获取当前最大 sortOrder
    const members = await this.teamMemberRepo.findByTeamId(teamId);
    const maxSortOrder = members.reduce((max, m) => Math.max(max, m.sortOrder), 0);

    return this.teamMemberRepo.create({
      teamId,
      characterId,
      role: "member",
      sortOrder: maxSortOrder + 1,
      characterSnapshot: this.buildCharacterSnapshot(character),
    });
  }

  async removeMember(teamId: string, characterId: string) {
    const team = await this.teamRepo.findById(teamId);
    if (!team) {
      throw new Error("团队不存在");
    }

    // 不能移除主理人
    if (characterId === team.leaderCharacterId) {
      throw new Error("不能移除主理人，请先更换主理人");
    }

    return this.teamMemberRepo.deleteByTeamIdAndCharacterId(teamId, characterId);
  }

  async updateMemberOrder(teamId: string, characterId: string, sortOrder: number) {
    // Prisma 不支持直接更新复合唯一键的记录，先删后建
    const existing = await this.teamMemberRepo.findByTeamIdAndCharacterId(teamId, characterId);
    if (!existing) {
      throw new Error("成员不存在");
    }

    await this.teamMemberRepo.deleteByTeamIdAndCharacterId(teamId, characterId);
    return this.teamMemberRepo.create({
      teamId,
      characterId,
      role: existing.role,
      sortOrder,
      characterSnapshot: existing.characterSnapshot,
    });
  }

  async refreshMemberSnapshot(teamId: string, characterId: string) {
    const character = await this.characterRepo.findById(characterId);
    if (!character) {
      throw new Error("角色不存在");
    }

    const existing = await this.teamMemberRepo.findByTeamIdAndCharacterId(teamId, characterId);
    if (!existing) {
      throw new Error("成员不存在");
    }

    await this.teamMemberRepo.deleteByTeamIdAndCharacterId(teamId, characterId);
    return this.teamMemberRepo.create({
      teamId,
      characterId,
      role: existing.role,
      sortOrder: existing.sortOrder,
      characterSnapshot: this.buildCharacterSnapshot(character),
    });
  }

  // --- Private Helpers ---

  /**
   * 转换团队数据中的所有资源 URL（Electron 环境需要绝对路径）
   */
  private transformTeamUrls(team: any): any {
    if (!team) return team;
    return {
      ...team,
      avatarUrl: team.avatarUrl
        ? this.urlService.toResourceAbsoluteUrl(team.avatarUrl)
        : null,
      leader: team.leader
        ? {
            ...team.leader,
            avatarUrl: team.leader.avatarUrl
              ? this.urlService.toResourceAbsoluteUrl(team.leader.avatarUrl)
              : null,
          }
        : team.leader,
      members: (team.members || []).map((m: any) => ({
        ...m,
        characterSnapshot: m.characterSnapshot
          ? {
              ...m.characterSnapshot,
              avatarUrl: m.characterSnapshot.avatarUrl
                ? this.urlService.toResourceAbsoluteUrl(m.characterSnapshot.avatarUrl)
                : undefined,
            }
          : m.characterSnapshot,
        character: m.character
          ? {
              ...m.character,
              avatarUrl: m.character.avatarUrl
                ? this.urlService.toResourceAbsoluteUrl(m.character.avatarUrl)
                : null,
            }
          : m.character,
      })),
    };
  }

  /**
   * 构建角色摘要（保存到 TeamMember.characterSnapshot）
   */
  private buildCharacterSnapshot(character: any): CharacterSnapshot {
    return {
      title: character.title,
      description: character.description || undefined,
      avatarUrl: character.avatarUrl || undefined,
    };
  }

}
