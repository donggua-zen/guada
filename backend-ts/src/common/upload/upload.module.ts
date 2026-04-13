import { Global, Module } from "@nestjs/common";
import { UploadPathService } from "../services/upload-path.service";

@Global()
@Module({
  providers: [UploadPathService],
  exports: [UploadPathService],
})
export class UploadModule {}
