import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { JobRegistryService } from "./job-registry.service";
import type { JobId, JobReadOptions } from "./job.types";

/**
 * 前端 jobs 快照/日志端点。
 *
 * 不做旧 process REST 兼容：前端在同一个版本迁移到本控制器。
 * UI 读取终态日志不调用 markReported（看日志不应吞掉模型完成通知）。
 */
@Controller()
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly registry: JobRegistryService) {}

  @Get("sessions/:id/jobs")
  async listJobs(@Param("id") id: string) {
    return this.registry.snapshot(id);
  }

  @Post("sessions/:id/jobs/:jobId/kill")
  killJob(
    @Param("id") id: string,
    @Param("jobId") jobId: string,
    @Query("reason") reason?: string,
  ) {
    try {
      const outcome = this.registry.kill(jobId as JobId, id, reason);
      const job = this.registry.get(jobId as JobId, id);
      if (!job) {
        throw new HttpException("Job not found", HttpStatus.NOT_FOUND);
      }
      return {
        success: true,
        outcome,
        status: job.status,
      };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error?.message || "Job not found",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Get("sessions/:id/jobs/:jobId/output")
  async readJobOutput(
    @Param("id") id: string,
    @Param("jobId") jobId: string,
    @Query("offset") offset?: string,
    @Query("maxBytes") maxBytes?: string,
  ) {
    const options: JobReadOptions = {};
    if (offset !== undefined && offset !== "") {
      const value = Number(offset);
      if (!Number.isFinite(value)) {
        throw new HttpException("offset must be a number", HttpStatus.BAD_REQUEST);
      }
      options.offset = value;
    }
    if (maxBytes !== undefined && maxBytes !== "") {
      const value = Number(maxBytes);
      if (!Number.isFinite(value)) {
        throw new HttpException(
          "maxBytes must be a number",
          HttpStatus.BAD_REQUEST,
        );
      }
      options.maxBytes = value;
    }

    try {
      const result = await this.registry.read(
        jobId as JobId,
        id,
        options,
        { markReported: false },
      );
      return {
        ...result.output,
        jobId,
        status: result.job.status,
        exitCode: result.job.exitCode ?? null,
        logFilePath: result.job.logFilePath ?? result.output.logFilePath,
      };
    } catch (error: any) {
      throw new HttpException(
        error?.message || "Job output not found",
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
