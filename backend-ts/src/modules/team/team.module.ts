import { Module } from "@nestjs/common";
import { TeamController } from "./team.controller";
import { TeamService } from "./team.service";
import { TeamRepository, TeamMemberRepository } from "../../common/database/team.repository";
import { CharacterRepository } from "../../common/database/character.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { SharedModule } from "../../common/services/shared.module";

@Module({
  imports: [AuthModule, SharedModule],
  controllers: [TeamController],
  providers: [
    TeamService,
    TeamRepository,
    TeamMemberRepository,
    CharacterRepository,
    PrismaService,
  ],
  exports: [TeamService],
})
export class TeamModule {}
