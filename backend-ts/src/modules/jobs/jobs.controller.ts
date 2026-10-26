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
      throw this.toHttpException(error, "Job not found");
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
      throw this.toHttpException(error, "Failed to read job output");
    }
  }

  /**
   * 错误分层（旧实现一律 404，会把"读日志失败"谎报成"作业不存在"）：
   * - unknown job / belongs to another session → 404（资源不存在或不可见）
   * - 参数校验（offset / maxBytes 非数字）已在调用前抛 400，这里原样透传
   * - 其余（执行器读取失败、日志损坏等）→ 500
   */
  private toHttpException(error: unknown, fallback: string): HttpException {
    if (error instanceof HttpException) return error;
    const message =
      error instanceof Error && error.message
        ? error.message
        : String(error ?? fallback);
    return new HttpException(
      message || fallback,
      isJobNotFoundMessage(message)
        ? HttpStatus.NOT_FOUND
        : HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

/** registry 侧的两类"作业不可见"错误（见 JobRegistryService.getRecord） */
function isJobNotFoundMessage(message: string): boolean {
  return /^unknown job /.test(message) || /belongs to another session/.test(message);
}
