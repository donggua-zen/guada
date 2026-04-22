import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  folderName: string;

  @IsOptional()
  @IsString()
  parentFolderId: string | null;
}
