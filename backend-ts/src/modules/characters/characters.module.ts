import { Module } from "@nestjs/common";
import { CharactersController } from "./characters.controller";
import { CharacterService } from "./character.service";
import { CharacterRepository } from "../../common/database/character.repository";
import { CharacterGroupRepository } from "../../common/database/character-group.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { ToolsModule } from "../tools/tools.module";

@Module({
  imports: [AuthModule, ToolsModule],
  controllers: [CharactersController],
  providers: [CharacterService, CharacterRepository, CharacterGroupRepository, PrismaService],
  exports: [CharacterRepository],
})
export class CharactersModule { }
