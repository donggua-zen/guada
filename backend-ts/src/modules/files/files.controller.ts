import { Controller, Post, Put, Param, Body, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { FileService } from './file.service';

@Controller()
@UseGuards(AuthGuard)
export class FilesController {
    constructor(private readonly fileService: FileService) { }

    /**
     * 上传会话文件（支持图片、PDF、文本）
     */
    @Post('sessions/:sessionId/files')
    @UseInterceptors(FileInterceptor('file'))
    async uploadMessageFile(
        @Param('sessionId') sessionId: string,
        @UploadedFile() file: any,
        @CurrentUser() user: any,
    ) {
        if (!file) {
            throw new Error('No file provided');
        }
        return this.fileService.uploadFile(sessionId, file, user.sub);
    }

    /**
     * 更新/复制文件
     */
    @Put('files/:fileId')
    async updateMessageFile(
        @Param('fileId') fileId: string,
        @Body() body: { message_id?: string; type?: string },
        @CurrentUser() user: any,
    ) {
        if (body.type === 'copy') {
            if (!body.message_id) {
                throw new Error('message_id is required for copy operation');
            }
            // 从消息中获取目标会话 ID
            return this.fileService.copyFile(fileId, body.message_id, user.sub);
        }
        throw new Error('Unsupported operation type');
    }
}
