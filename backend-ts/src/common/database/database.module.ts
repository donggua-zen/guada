import { Module, Global } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { UserRepository } from "./user.repository";

@Global()
@Module({
  providers: [PrismaService, UserRepository],
  exports: [PrismaService, UserRepository],
})
export class DatabaseModule {}
