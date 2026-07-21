import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { CharacterService } from "./character.service";
import { FileInterceptor } from "@nestjs/platform-express";
import { ToolOrchestrator } from "../tools/tool-orchestrator.service";
import { PluginManager } from "../plugins/plugin.manager";

@Controller()
@UseGuards(AuthGuard)
export class CharactersController {
  constructor(
    private readonly characterService: CharacterService,
    private readonly toolOrchestrator: ToolOrchestrator,
    private readonly pluginManager: PluginManager,
  ) {}

  @Get("characters")
  async getCharacters(@Query() query: any) {
    const { groupId, skip = 0, limit = 20 } = query;
    return this.characterService.getCharacters(
      Number(skip),
      Number(limit),
      groupId,
    );
  }

  // --- Character Group Endpoints ---
  @Get("character-groups")
  async getCharacterGroups() {
    return this.characterService.getGroups();
  }

  @Post("character-groups")
  async createCharacterGroup(@Body() data: any, @CurrentUser() user: any) {
    return this.characterService.createGroup(user.id, data);
  }

  @Put("character-groups/:id")
  async updateCharacterGroup(@Param("id") id: string, @Body() data: any) {
    return this.characterService.updateGroup(id, data);
  }

  @Delete("character-groups/:id")
  async deleteCharacterGroup(@Param("id") id: string) {
    await this.characterService.deleteGroup(id);
    return { success: true };
  }

  @Get("characters/:id")
  async getCharacterById(@Param("id") id: string) {
    return this.characterService.getCharacterById(id);
  }

  @Post("characters")
  async createCharacter(@Body() data: any, @CurrentUser() user: any) {
    return this.characterService.createCharacter(user.id, data);
  }

  @Put("characters/:id")
  async updateCharacter(@Param("id") id: string, @Body() data: any) {
    return this.characterService.updateCharacter(id, data);
  }

  @Delete("characters/:id")
  async deleteCharacter(@Param("id") id: string) {
    await this.characterService.deleteCharacter(id);
    return { success: true };
  }

  @Post("characters/:id/avatars")
  @UseInterceptors(FileInterceptor("avatar"))
  async uploadAvatar(@Param("id") id: string, @UploadedFile() file: any) {
    return this.characterService.uploadAvatar(id, file);
  }

  @Post("characters/import")
  async importCharacters(@Body() data: { files: { content: string; filename: string }[] }, @CurrentUser() user: any) {
    return this.characterService.importCharacters(user.id, data.files || []);
  }
}
