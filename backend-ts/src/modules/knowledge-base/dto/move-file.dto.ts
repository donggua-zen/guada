import { IsOptional, IsString } from 'class-validator';

export class MoveFileDto {
  @IsOptional()
  @IsString()
  targetParentFolderId: string | null;
}
