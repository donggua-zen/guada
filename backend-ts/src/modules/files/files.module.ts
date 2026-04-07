import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FileService } from './file.service';
import { FileRepository } from '../../common/database/file.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [FileService, FileRepository, PrismaService],
})
export class FilesModule {}
