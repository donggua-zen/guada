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
import { CharacterService } from "./character.service";
import { FileInterceptor } from "@nestjs/platform-express";

@Controller()
@UseGuards(AuthGuard)
export class CharactersController {
  constructor(private readonly characterService: CharacterService) {}

  @Get("characters")
  async getCharacters(@Query() query: any) {
    const { skip = 0, limit = 20 } = query;
    return this.characterService.getCharacters(Number(skip), Number(limit));
  }

  @Get("characters/:id")
  async getCharacterById(@Param("id") id: string) {
    return this.characterService.getCharacterById(id);
  }

  @Post("characters")
  async createCharacter(@Body() data: any) {
    return this.characterService.createCharacter(data);
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
  async importCharacters(
    @Body() data: { files: { content: string; filename: string }[] },
  ) {
    return this.characterService.importCharacters(data.files || []);
  }
}
