import { NestFactory } from "@nestjs/core";
import { WinstonModule } from 'nest-winston';
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { UrlService } from "./common/services/url.service";
import { createWinstonConfig } from './common/logger/winston.config';
import * as express from "express";
import * as path from "path";
import * as fs from "fs";

async function bootstrap() {
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
  app.enableCors(); // Enable CORS for frontend integration

  // 支持通过环境变量 PORT 指定端口，若未指定则使用 3000
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
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

  // 如果是在 fork/child_process 环境中，通过 IPC 向父进程发送端口信息
  if (process.send) {
    console.log(`正在通过 IPC 发送端口: ${actualPort}`);
    process.send({ type: 'PORT_READY', port: actualPort });
  } else {
    console.log('⚠️  process.send 不可用，当前不在 IPC 环境中');
  }
}
bootstrap();
