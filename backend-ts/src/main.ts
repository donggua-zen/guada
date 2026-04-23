import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
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
  app.use(
    "/static",
    express.static(staticPath, {
      setHeaders: (res, filePath) => {
        // 确保静态资源响应头支持 UTF-8
        res.setHeader("Content-Disposition", "inline; charset=utf-8");
      },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors(); // Enable CORS for frontend integration
  
  // Electron 环境下使用固定端口 3000，避免动态端口的竞态问题
  const port = 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
