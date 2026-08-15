import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { GitController } from "./git.controller";
import { GitService } from "./git.service";

@Module({
  imports: [AuthModule, ChatModule],
  controllers: [GitController],
  providers: [GitService],
})
export class GitModule {}
