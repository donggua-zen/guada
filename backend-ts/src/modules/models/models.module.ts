import { Module } from "@nestjs/common";
import { ModelsController } from "./models.controller";
import { ModelService } from "./model.service";
import { ProviderFileStore } from "../llm-core/provider-file.store";
import { AuthModule } from "../auth/auth.module";
import { LlmCoreModule } from "../llm-core/providers.module";

@Module({
  imports: [AuthModule, LlmCoreModule],
  controllers: [ModelsController],
  providers: [ModelService],
  exports: [],
})
export class ModelsModule {}
