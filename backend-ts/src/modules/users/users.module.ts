import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UserService } from "./user.service";
import { AuthModule } from "../auth/auth.module";
import { MobileAccessModule } from "../mobile-access/mobile-access.module";

@Module({
  imports: [AuthModule, MobileAccessModule],
  controllers: [UsersController],
  providers: [UserService],
})
export class UsersModule {}
