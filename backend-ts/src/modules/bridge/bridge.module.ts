import { Module, Global } from "@nestjs/common";
import { BridgeClient } from "./bridge-client";

@Global()
@Module({
  providers: [BridgeClient],
  exports: [BridgeClient],
})
export class BridgeModule {}
