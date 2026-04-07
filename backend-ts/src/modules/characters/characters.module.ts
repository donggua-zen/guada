import { Module } from '@nestjs/common';
import { CharactersController } from './characters.controller';
import { CharacterService } from './character.service';
import { CharacterRepository } from '../../common/database/character.repository';
import { PrismaService } from '../../common/database/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CharactersController],
  providers: [CharacterService, CharacterRepository, PrismaService],
})
export class CharactersModule {}
