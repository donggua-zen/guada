import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { TokenizerService } from "../src/common/utils/tokenizer.service";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tokenizerService = app.get(TokenizerService);

  try {
    // 测试初始化
    console.log("正在初始化 Qwen3 Tokenizer...");
    await tokenizerService.initialize("qwen3");

    // 测试简单文本
    const text = "你好，世界！Hello, World!";
    const count = tokenizerService.countTokens("qwen3", text);
    console.log(`文本: "${text}"`);
    console.log(`Token 数量: ${count}`);

    // 测试消息数组
    const messages = [
      { role: "system", content: "你是一个助手" },
      { role: "user", content: "请介绍一下你自己" },
    ];
    const msgCount = tokenizerService.countTokens("qwen3", messages);
    console.log(`消息数组 Token 数量: ${msgCount}`);

  } catch (error) {
    console.error("测试失败:", error);
  } finally {
    await app.close();
  }
}

bootstrap();
