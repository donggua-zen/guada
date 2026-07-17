/**
 * UMI OCR 接口测试脚本 - 修复版
 * 用正确的 language 参数测试 OCR 是否正常
 *
 * 用法: npx ts-node scripts/test-ocr-umi-fix.ts <pdf路径>
 */
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import FormData from "form-data";

const UMI_HOST = "127.0.0.1";
const UMI_PORT = 1224;
const BASE_URL = `http://${UMI_HOST}:${UMI_PORT}`;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function testOcrUmi(filePath: string) {
  console.log("=".repeat(80));
  console.log("UMI OCR 接口测试 - 修复版 (使用正确 language 参数)");
  console.log("=".repeat(80));
  console.log(`文件: ${filePath}`);
  console.log(`服务: ${BASE_URL}`);
  console.log("");

  // 1. 上传 PDF - 使用正确的 language key
  console.log("--- 1. 上传 PDF (使用 models/config_chinese.txt) ---");
  const filename = path.basename(filePath);
  const fileData = await fs.promises.readFile(filePath);

  const form = new FormData();
  form.append("file", fileData, { filename, contentType: "application/pdf" });
  form.append(
    "json",
    JSON.stringify({
      // 关键修复：用 key 而非显示名
      "ocr.language": "models/config_chinese.txt",
      "doc.extractionMode": "mixed",
    }),
  );

  const uploadResp = await axios.post(`${BASE_URL}/api/doc/upload`, form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });

  console.log("状态码:", uploadResp.status);
  console.log("原始响应:", JSON.stringify(uploadResp.data, null, 2));
  console.log("");

  if (uploadResp.data.code !== 100) {
    console.error("上传失败:", uploadResp.data.data);
    return;
  }

  const msnId = uploadResp.data.data;
  console.log(`任务ID: ${msnId}`);
  console.log("");

  // 2. 轮询结果
  console.log("--- 2. 轮询结果 ---");
  let isDone = false;
  let pollCount = 0;
  const maxPolls = 600; // 最多等5分钟

  while (!isDone && pollCount < maxPolls) {
    pollCount++;
    await sleep(500);

    const resultResp = await axios.post(
      `${BASE_URL}/api/doc/result`,
      {
        id: msnId,
        is_data: true,
        format: "dict",
        is_unread: true,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      },
    );

    const result = resultResp.data;

    // 只打印关键状态
    process.stdout.write(
      `\r[轮询 #${pollCount}] 进度: ${result.processed_count}/${result.pages_count} 页, state: ${result.state}`,
    );

    if (result.is_done) {
      isDone = true;
      console.log("\n");

      if (result.state === "success") {
        console.log("--- 3. 识别成功 ---");

        // 获取完整结果
        const finalResp = await axios.post(
          `${BASE_URL}/api/doc/result`,
          {
            id: msnId,
            is_data: true,
            format: "dict",
            is_unread: false,
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 30000,
          },
        );

        const finalData = finalResp.data;
        const pages = finalData.data || [];

        console.log(`总页数: ${pages.length}`);
        console.log("");

        // 检查每页结果
        let totalTextLen = 0;
        let errorPages = 0;
        let successPages = 0;

        for (const [i, page] of pages.entries()) {
          const pageNum = page.page || i + 1;

          // 关键检查：pageData.data 的类型
          const dataType = typeof page.data;
          const isArray = Array.isArray(page.data);

          if (isArray) {
            // 正常OCR结果：数组，每个元素有 text, score, box
            const texts = page.data.map((l: any) => l.text).join("\n");
            totalTextLen += texts.length;
            successPages++;
            if (i < 3) {
              // 只打印前3页样例
              console.log(`  第${pageNum}页: ${texts.slice(0, 100)}...`);
            }
          } else if (dataType === "string") {
            // 错误信息
            errorPages++;
            if (i < 3) {
              console.log(
                `  第${pageNum}页 [错误]: ${(page.data as string).slice(0, 100)}...`,
              );
            }
          } else {
            errorPages++;
            console.log(`  第${pageNum}页 [未知类型]: ${dataType}`);
          }
        }

        console.log("");
        console.log("--- 统计 ---");
        console.log(`成功页数: ${successPages}/${pages.length}`);
        console.log(`错误页数: ${errorPages}/${pages.length}`);
        console.log(`总识别文本长度: ${totalTextLen} 字符`);

        if (successPages > 0) {
          console.log("\n🎉 OCR 正常工作！Bug 确认: ocr.language 参数值错误");
        } else {
          console.log("\n❌ OCR 仍然失败，需进一步排查");
        }
      } else {
        console.log("--- 识别失败 ---");
        console.log(`state: ${result.state}`);
        console.log(`message: ${result.message}`);
      }
    }
  }

  // 4. 清理任务
  console.log("\n--- 4. 清理任务 ---");
  try {
    const clearResp = await axios.get(`${BASE_URL}/api/doc/clear/${msnId}`, {
      timeout: 5000,
    });
    console.log("清理结果:", JSON.stringify(clearResp.data));
  } catch (e: any) {
    console.log("清理失败(可忽略):", e.message);
  }

  console.log("=".repeat(80));
  console.log("测试完成");
}

// 主入口
const filePath = process.argv[2];
if (!filePath) {
  console.error("用法: npx ts-node scripts/test-ocr-umi-fix.ts <pdf路径>");
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`文件不存在: ${filePath}`);
  process.exit(1);
}

testOcrUmi(filePath).catch((err) => {
  console.error("测试异常:", err);
  process.exit(1);
});