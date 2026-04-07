import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UserService } from './user.service';
import { UserRepository } from '../../common/database/user.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UserService, UserRepository, PrismaService],
})
export class UsersModule {}
