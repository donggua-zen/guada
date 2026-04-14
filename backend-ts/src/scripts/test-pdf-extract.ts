/**
 * PDF 内容提取测试脚本
 * 
 * 用途: 验证 PDF 文件上传时内容是否能正确提取
 * 运行: npm run test:pdf-extract
 */

import { FileParserService } from '../modules/knowledge-base/file-parser.service';
import * as fs from 'fs';
import * as path from 'path';

async function testPdfExtraction() {
  console.log('=== PDF 内容提取测试 ===\n');

  // 创建 FileParserService 实例
  const parserService = new FileParserService();

  // 查找测试 PDF 文件
  const testDataDir = path.join(__dirname, '../../data');
  const pdfFiles = fs.readdirSync(testDataDir).filter(f => f.endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    console.error('❌ 未找到 PDF 测试文件');
    console.log(`请在 ${testDataDir} 目录下放置 PDF 文件`);
    return;
  }

  console.log(`找到 ${pdfFiles.length} 个 PDF 文件:\n`);

  for (const pdfFile of pdfFiles) {
    console.log(`📄 测试文件: ${pdfFile}`);
    
    try {
      // 读取文件
      const filePath = path.join(testDataDir, pdfFile);
      const fileBuffer = fs.readFileSync(filePath);
      const fileSize = fileBuffer.length;
      
      console.log(`   文件大小: ${(fileSize / 1024).toFixed(2)} KB`);

      // 检测文件类型
      const fileType = await parserService.detectFileType('pdf');
      console.log(`   文件类型: ${fileType}`);

      // 解析 PDF
      const startTime = Date.now();
      const content = await parserService.parseFile(
        fileBuffer,
        fileType,
        'pdf',
        fileSize
      );
      const elapsed = Date.now() - startTime;

      console.log(`   解析耗时: ${elapsed}ms`);
      console.log(`   内容长度: ${content.length} 字符`);
      
      if (content.length > 0) {
        console.log(`   ✅ 提取成功`);
        console.log(`   预览内容 (前200字符):\n   ${content.substring(0, 200).replace(/\n/g, '\\n')}...\n`);
      } else {
        console.log(`   ❌ 提取内容为空\n`);
      }

    } catch (error: any) {
      console.error(`   ❌ 解析失败: ${error.message}\n`);
    }
  }

  console.log('=== 测试完成 ===');
}

// 运行测试
testPdfExtraction().catch(console.error);
