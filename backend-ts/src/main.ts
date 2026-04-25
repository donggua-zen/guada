import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { UrlService } from "./common/services/url.service";
import * as express from "express";
import * as path from "path";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 设置全局 API 前缀
  app.setGlobalPrefix("api/v1");

  // 增强对中文文件名的支持
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(express.json({ limit: "50mb" }));

  // 设置静态文件目录（支持环境变量覆盖）
  const staticPath = process.env.STATIC_DIR || path.join(__dirname, "..", "static");
  const staticPrefix = process.env.STATIC_URL || "/static";
  app.use(
    staticPrefix,
    express.static(staticPath, {
      setHeaders: (res, filePath) => {
        // 确保静态资源响应头支持 UTF-8
        res.setHeader("Content-Disposition", "inline; charset=utf-8");
      },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
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
    console.log(`🔗 BASE_URL 已动态设置为: ${baseUrl}`);
  }
  
  console.log(`Application is running on: http://localhost:${actualPort}`);
  
  // 如果是在 fork/child_process 环境中，通过 IPC 向父进程发送端口信息
  if (process.send) {
    console.log(`📤 正在通过 IPC 发送端口: ${actualPort}`);
    process.send({ type: 'PORT_READY', port: actualPort });
  } else {
    console.log('⚠️  process.send 不可用，当前不在 IPC 环境中');
  }
}
bootstrap();
