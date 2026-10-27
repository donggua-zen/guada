import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { CapabilitiesController } from "./capabilities.controller";

@Module({
  controllers: [HealthController, CapabilitiesController],
})
export class HealthModule {}
