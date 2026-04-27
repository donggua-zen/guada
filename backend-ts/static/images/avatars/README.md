# 默认角色头像

此目录存放默认角色的头像文件。

## 文件列表

- `assistant-default.jpg` - 智能助手默认头像
- `pm-default.jpg` - 产品经理默认头像
- `writer-default.jpg` - 剧本编剧默认头像

## 使用说明

1. 这些头像文件会被种子脚本引用，路径为：`static/images/avatars/xxx.jpg`
2. 用户可以通过上传新头像来覆盖默认头像
3. 建议头像尺寸：512x512 或更大，格式：JPG/PNG
4. 头像会在上传时自动压缩和优化

## 添加新默认头像

1. 将头像文件放入此目录
2. 在 `backend-ts/src/scripts/seed.ts` 中添加新的角色配置
3. 运行种子脚本：`npm run db:seed --force`
