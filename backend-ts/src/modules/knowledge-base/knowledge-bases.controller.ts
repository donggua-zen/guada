import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { KnowledgeBaseService } from './knowledge-base.service';

@Controller('knowledge-bases')
@UseGuards(AuthGuard)
export class KnowledgeBasesController {
  constructor(private kbService: KnowledgeBaseService) {}

  @Get()
  async list(
    @Query('skip') skip = 0,
    @Query('limit') limit = 20,
    @CurrentUser() user: any,
  ) {
    return await this.kbService.list(user.sub, Number(skip), Number(limit));
  }

  @Post()
  async create(@Body() data: any, @CurrentUser() user: any) {
    return await this.kbService.create(user.sub, data);
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.kbService.findOne(id, user.sub);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
    return await this.kbService.update(id, user.sub, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.kbService.remove(id, user.sub);
  }
}
