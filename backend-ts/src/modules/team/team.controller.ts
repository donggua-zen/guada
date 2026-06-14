import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { TeamService } from "./team.service";

@Controller()
@UseGuards(AuthGuard)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  // --- Team CRUD ---

  @Get("teams")
  async getTeams(
    @CurrentUser() user: any,
    @Query("skip") skip?: string,
    @Query("limit") limit?: string,
  ) {
    return this.teamService.getTeams(
      user.id,
      skip ? Number(skip) : 0,
      limit ? Number(limit) : 20,
    );
  }

  @Get("teams/:id")
  async getTeamById(@Param("id") id: string) {
    return this.teamService.getTeamById(id);
  }

  @Post("teams")
  async createTeam(@Body() data: any, @CurrentUser() user: any) {
    return this.teamService.createTeam(user.id, {
      name: data.name,
      description: data.description,
      avatarUrl: data.avatarUrl,
      leaderCharacterId: data.leaderCharacterId,
      memberCharacterIds: data.memberCharacterIds,
      settings: data.settings,
    });
  }

  @Put("teams/:id")
  async updateTeam(@Param("id") id: string, @Body() data: any) {
    return this.teamService.updateTeam(id, {
      name: data.name,
      description: data.description,
      avatarUrl: data.avatarUrl,
      leaderCharacterId: data.leaderCharacterId,
      settings: data.settings,
    });
  }

  @Delete("teams/:id")
  async deleteTeam(@Param("id") id: string) {
    await this.teamService.deleteTeam(id);
    return { success: true };
  }

  // --- Member Management ---

  @Post("teams/:id/members")
  async addMember(
    @Param("id") teamId: string,
    @Body() data: { characterId: string },
  ) {
    return this.teamService.addMember(teamId, data.characterId);
  }

  @Delete("teams/:id/members/:characterId")
  async removeMember(
    @Param("id") teamId: string,
    @Param("characterId") characterId: string,
  ) {
    await this.teamService.removeMember(teamId, characterId);
    return { success: true };
  }

  @Put("teams/:id/members/:characterId/order")
  async updateMemberOrder(
    @Param("id") teamId: string,
    @Param("characterId") characterId: string,
    @Body() data: { sortOrder: number },
  ) {
    return this.teamService.updateMemberOrder(
      teamId,
      characterId,
      data.sortOrder,
    );
  }

  @Post("teams/:id/members/:characterId/refresh")
  async refreshMemberSnapshot(
    @Param("id") teamId: string,
    @Param("characterId") characterId: string,
  ) {
    return this.teamService.refreshMemberSnapshot(teamId, characterId);
  }

}
