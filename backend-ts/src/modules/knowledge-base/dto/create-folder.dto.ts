import { IsString, IsNotEmpty, MaxLength, IsOptional, Matches } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\\/:*?"<>|\x00-\x1f\x7f]+$/, {
    message: '名称包含非法字符，不允许使用：\\ / : * ? " < > | 及控制字符',
  })
  folderName: string;

  @IsOptional()
  @IsString()
  parentFolderId: string | null;
}
