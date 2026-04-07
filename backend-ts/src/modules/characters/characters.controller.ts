import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CharacterService } from './character.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller()
@UseGuards(AuthGuard)
export class CharactersController {
  constructor(private readonly characterService: CharacterService) {}

  @Get('characters')
  async getCharacters(
    @Query('skip') skip = 0,
    @Query('limit') limit = 20,
    @CurrentUser() user: any,
  ) {
    return this.characterService.getCharactersByUser(user.sub, Number(skip), Number(limit));
  }

  @Get('shared/characters')
  async getSharedCharacters(
    @Query('skip') skip = 0,
    @Query('limit') limit = 20,
  ) {
    return this.characterService.getSharedCharacters(Number(skip), Number(limit));
  }

  @Get('characters/:id')
  async getCharacterById(@Param('id') id: string, @CurrentUser() user: any) {
    return this.characterService.getCharacterById(id, user.sub);
  }

  @Post('characters')
  async createCharacter(@Body() data: any, @CurrentUser() user: any) {
    return this.characterService.createCharacter(user.sub, data);
  }

  @Put('characters/:id')
  async updateCharacter(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
    return this.characterService.updateCharacter(id, user.sub, data);
  }

  @Delete('characters/:id')
  async deleteCharacter(@Param('id') id: string, @CurrentUser() user: any) {
    await this.characterService.deleteCharacter(id, user.sub);
    return { success: true };
  }

  @Post('characters/:id/avatars')
  @UseInterceptors(FileInterceptor('avatar'))
  async uploadAvatar(@Param('id') id: string, @UploadedFile() file: any, @CurrentUser() user: any) {
    // 实际实现中应调用上传服务获取 URL
    const fileUrl = `/uploads/${file.originalname}`;
    return this.characterService.uploadAvatar(id, user.sub, fileUrl);
  }
}
