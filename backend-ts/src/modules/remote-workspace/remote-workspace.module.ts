import { Module } from "@nestjs/common";
import { RemoteWorkspaceController } from "./remote-workspace.controller";
import { RemoteWorkspaceService } from "./remote-workspace.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [RemoteWorkspaceController],
  providers: [RemoteWorkspaceService],
  exports: [RemoteWorkspaceService],
})
export class RemoteWorkspaceModule {}
