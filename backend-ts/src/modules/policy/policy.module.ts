import { Module } from "@nestjs/common";
import { PolicyController } from "./policy.controller";
import { SharedModule } from "../../common/services/shared.module";
import { AuthModule } from "../auth/auth.module";

/**
 * 命令策略规则模块：只读/写入用户可配的 policy.yaml（服务本身在 SharedModule，全局可用）。
 */
@Module({
  imports: [SharedModule, AuthModule],
  controllers: [PolicyController],
})
export class PolicyModule {}
