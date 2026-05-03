import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionService } from "./session.service";

@Controller()
@UseGuards(AuthGuard)
export class SessionsController {
  constructor(private readonly sessionService: SessionService) { }

  @Get("sessions")
  async getSessions(
    @Query("skip") skip = 0,
    @Query("limit") limit = 20,
    @CurrentUser() user: any,
  ) {
    return this.sessionService.getSessionsByUser(
      user.id,
      Number(skip),
      Number(limit),
    );
  }

  @Post("sessions")
  async createSession(@Body() data: any, @CurrentUser() user: any) {
    return this.sessionService.createSession(user.id, data);
  }

  @Get("sessions/:id")
  async getSession(@Param("id") id: string, @CurrentUser() user: any) {
    return this.sessionService.getSessionById(id, user.id);
  }

  @Put("sessions/:id")
  async updateSession(
    @Param("id") id: string,
    @Body() data: any,
    @CurrentUser() user: any,
  ) {
    return this.sessionService.updateSession(id, user.id, data);
  }

  @Delete("sessions/:id")
  async deleteSession(@Param("id") id: string, @CurrentUser() user: any) {
    await this.sessionService.deleteSession(id, user.id);
    return { success: true };
  }

  @Post("sessions/:id/generate-title")
  async generateTitle(@Param("id") id: string, @CurrentUser() user: any) {
    return this.sessionService.generateTitle(id, user.id);
  }

  // TODO: compressHistory 方法尚未实现,暂时注释
  // @Post("sessions/:id/compress-history")
  // async compressHistory(
  //   @Param("id") id: string,
  //   @Body()
  //   body: { compressionRatio?: number; minRetainedTurns?: number; cleaningStrategy?: string },
  //   @CurrentUser() user: any,
  // ) {
  //   const { compressionRatio = 50, minRetainedTurns = 3, cleaningStrategy = "moderate" } = body;
  //   return this.sessionService.compressHistory(
  //     id,
  //     user.id,
  //     Number(compressionRatio),
  //     Number(minRetainedTurns),
  //     cleaningStrategy as any,
  //   );
  // }

  @Get("sessions/:id/summaries")
  async getSessionSummaries(@Param("id") id: string, @CurrentUser() user: any) {
    return this.sessionService.getSessionSummaries(id, user.id);
  }

  @Put("sessions/summaries/:summaryId")
  async updateSummary(
    @Param("summaryId") summaryId: string,
    @Body() body: { summaryContent?: string },
    @CurrentUser() user: any,
  ) {
    return this.sessionService.updateSummary(summaryId, user.id, body);
  }

  @Delete("sessions/summaries/:summaryId")
  async deleteSummary(
    @Param("summaryId") summaryId: string,
    @CurrentUser() user: any,
  ) {
    await this.sessionService.deleteSummary(summaryId, user.id);
    return { success: true };
  }

  @Get("sessions/:id/token-stats")
  async getTokenStats(@Param("id") id: string, @CurrentUser() user: any) {
    return this.sessionService.getTokenStats(id, user.id);
  }

  @Post("sessions/:id/compress")
  async compressSession(
    @Param("id") id: string,
    @CurrentUser() user: any,
  ) {
    return this.sessionService.compressSession(id, user.id);
  }
}
