import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 设置全局 API 前缀
  app.setGlobalPrefix('api/v1');

  // 设置静态文件目录
  app.use('/static', express.static(path.join(__dirname, '..', 'static')));

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors(); // Enable CORS for frontend integration
  await app.listen(3000);
  console.log(`Application is running on: http://localhost:3000`);
}
bootstrap();
