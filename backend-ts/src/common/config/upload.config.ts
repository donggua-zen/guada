import { registerAs } from '@nestjs/config';

export default registerAs('upload', () => ({
    baseDir: process.env.UPLOAD_BASE_DIR || './static/file_stores',
    publicPrefix: process.env.UPLOAD_PUBLIC_PREFIX || '/static/file_stores',
    avatarDir: process.env.UPLOAD_AVATAR_DIR || 'avatars',
    imageDir: process.env.UPLOAD_IMAGE_DIR || 'images',
    previewDir: process.env.UPLOAD_PREVIEW_DIR || 'previews',
    fileDir: process.env.UPLOAD_FILE_DIR || 'files',
    kbDir: process.env.UPLOAD_KB_DIR || 'knowledge-base',
}));
