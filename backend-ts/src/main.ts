import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 设置全局 API 前缀
  app.setGlobalPrefix('api/v1');

  // 增强对中文文件名的支持
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use(express.json({ limit: '50mb' }));

  // 设置静态文件目录
  app.use('/static/file_stores', express.static(path.join(__dirname, '..', 'static', 'file_stores'), {
    setHeaders: (res, filePath) => {
      // 确保静态资源响应头支持 UTF-8
      res.setHeader('Content-Disposition', 'inline; charset=utf-8');
    }
  }));

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors(); // Enable CORS for frontend integration
  await app.listen(3000);
  console.log(`Application is running on: http://localhost:3000`);
}
bootstrap();
