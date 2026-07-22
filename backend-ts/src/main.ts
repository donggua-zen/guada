import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { WinstonModule } from 'nest-winston';
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { UrlService } from "./common/services/url.service";
import { createWinstonConfig } from './common/logger/winston.config';
import { RequestTimingInterceptor } from "./common/interceptors/request-timing.interceptor";
import * as express from "express";
import * as path from "path";
import * as fs from "fs";

async function bootstrap() {
  // 修正工作目录到 backend-ts 根目录，确保 bundled-skills/、skills/ 等路径可预测
  const backendRoot = path.resolve(__dirname, '..');
  if (process.cwd() !== backendRoot) {
    process.chdir(backendRoot);
    console.log(`工作目录已修正: ${backendRoot}`);
  }

  // 确定日志目录（优先使用环境变量 LOGS_DIR）
  const logsDir = process.env.LOGS_DIR || path.join(process.cwd(), 'logs');
  
  // 确保日志目录存在
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // 创建应用实例并配置 Winston 日志
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createWinstonConfig(logsDir)),
  });

  // 设置全局 API 前缀
  app.setGlobalPrefix("api/v1");

  // 增强对中文文件名的支持
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(express.json({ limit: "50mb" }));

  // 基础静态文件目录（程序自带资源，如图片、模型等）
  const staticPath = process.env.STATIC_DIR || path.join(__dirname, "..", "static");
  const staticPrefix = process.env.STATIC_URL || "/static";

  console.log(`基础静态目录: ${staticPath} -> ${staticPrefix}`);
  app.use(
    staticPrefix,
    express.static(staticPath, {
      setHeaders: (res, filePath) => {
        // 确保静态资源响应头支持 UTF-8
        res.setHeader("Content-Disposition", "inline; charset=utf-8");
      },
    }),
  );

  // 上传文件目录（用户数据，持久化存储）
  const uploadPhysicalRoot = process.env.UPLOAD_ROOT_DIR;
  const uploadPublicPrefix = process.env.UPLOAD_URL_PREFIX || "/uploads";

  if (uploadPhysicalRoot && uploadPublicPrefix) {
    const resolvedPath = path.resolve(uploadPhysicalRoot);

    // 确保上传目录存在
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
      console.log(`创建上传目录: ${resolvedPath}`);
    }

    console.log(`上传文件目录: ${resolvedPath} -> ${uploadPublicPrefix}`);
    app.use(
      uploadPublicPrefix,
      express.static(resolvedPath, {
        setHeaders: (res, filePath) => {
          res.setHeader("Content-Disposition", "inline; charset=utf-8");
        },
      }),
    );
  } else {
    console.warn("⚠️  上传目录配置未设置（UPLOAD_ROOT_DIR 或 UPLOAD_URL_PREFIX），跳过挂载");
  }

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestTimingInterceptor());

  // 全局 ValidationPipe：whitelist=true 自动剔除 DTO 未声明的字段
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.enableCors(); // Enable CORS for frontend integration

  // 支持通过环境变量 PORT 指定端口，若未指定则使用 0 让系统自动分配可用端口
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
  await app.listen(port);
  const address = app.getHttpServer().address();
  const actualPort = typeof address === 'string' ? address.split(':').pop() : address.port;

  // 如果是自动模式，动态设置 BASE_URL
  const urlService = app.get(UrlService);
  if (urlService.isAutoMode()) {
    const baseUrl = `http://localhost:${actualPort}`;
    urlService.setBaseUrl(baseUrl);
    console.log(`BASE_URL 已动态设置为: ${baseUrl}`);
  }

  console.log(`Application is running on: http://localhost:${actualPort}`);

  // 通过 Bridge 通道向 Electron 上报端口
  const bridgePipePath = process.env.GUADA_BRIDGE_PATH;
  if (bridgePipePath) {
    try {
      const { BridgeClient } = await import("./modules/bridge/bridge-client");
      // 获取已初始化的 BridgeClient 实例
      const bridgeClient = app.get(BridgeClient);
      await bridgeClient.ready;
      bridgeClient.emit("port_ready", { port: actualPort });
      console.log(`已通过 Bridge 上报端口: ${actualPort}`);
    } catch (err: any) {
      console.warn("通过 Bridge 上报端口失败:", err?.message || err);
    }
  } else {
    console.log("非 Electron 环境，跳过端口上报");
  }
}
bootstrap();
