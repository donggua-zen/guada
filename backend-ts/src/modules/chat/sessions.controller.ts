import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionService } from './session.service';

@Controller()
@UseGuards(AuthGuard)
export class SessionsController {
    constructor(private readonly sessionService: SessionService) { }

    @Get('sessions')
    async getSessions(
        @Query('skip') skip = 0,
        @Query('limit') limit = 20,
        @CurrentUser() user: any,
    ) {
        return this.sessionService.getSessionsByUser(user.sub, Number(skip), Number(limit));
    }

    @Post('sessions')
    async createSession(@Body() data: any, @CurrentUser() user: any) {
        return this.sessionService.createSession(user.sub, data);
    }

    @Get('sessions/:id')
    async getSession(@Param('id') id: string, @CurrentUser() user: any) {
        return this.sessionService.getSessionById(id, user.sub);
    }

    @Put('sessions/:id')
    async updateSession(@Param('id') id: string, @Body() data: any, @CurrentUser() user: any) {
        return this.sessionService.updateSession(id, user.sub, data);
    }

    @Delete('sessions/:id')
    async deleteSession(@Param('id') id: string, @CurrentUser() user: any) {
        await this.sessionService.deleteSession(id, user.sub);
        return { success: true };
    }

    @Post('sessions/:id/generate-title')
    async generateTitle(@Param('id') id: string, @CurrentUser() user: any) {
        return this.sessionService.generateTitle(id, user.sub);
    }
}
