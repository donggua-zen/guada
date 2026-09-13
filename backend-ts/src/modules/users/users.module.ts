import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UserService } from "./user.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UserService],
})
export class UsersModule {}
