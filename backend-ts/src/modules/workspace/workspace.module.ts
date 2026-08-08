import { Module } from "@nestjs/common";
import { WorkspaceConnectionsController } from "./workspace-connections.controller";
import { WorkspaceConnectionsService } from "./workspace-connections.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [WorkspaceConnectionsController],
  providers: [WorkspaceConnectionsService],
  exports: [WorkspaceConnectionsService],
})
export class WorkspaceConnectionsModule {}
