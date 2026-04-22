import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class RenameFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\\/:*?"<>|\x00-\x1f\x7f]+$/, {
    message: '名称包含非法字符，不允许使用：\\ / : * ? " < > | 及控制字符',
  })
  newName: string;
}
