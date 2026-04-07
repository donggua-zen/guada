import { Module } from '@nestjs/common';
import { McpServersController } from './mcp-servers.controller';
import { McpServerService } from './mcp-server.service';
import { McpServerRepository } from '../../common/database/mcp-server.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [McpServersController],
  providers: [McpServerService, McpServerRepository, PrismaService],
})
export class McpServersModule {}
