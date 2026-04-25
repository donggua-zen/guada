import { Module } from "@nestjs/common";
import { ModelsController } from "./models.controller";
import { ModelService } from "./model.service";
import { ModelRepository } from "../../common/database/model.repository";
import { PrismaService } from "../../common/database/prisma.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [ModelsController],
  providers: [ModelService, ModelRepository, PrismaService],
})
export class ModelsModule {}
