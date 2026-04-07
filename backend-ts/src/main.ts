import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 设置全局 API 前缀
  app.setGlobalPrefix('api/v1');
  
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors(); // Enable CORS for frontend integration
  await app.listen(3000);
  console.log(`Application is running on: http://localhost:3000`);
}
bootstrap();
