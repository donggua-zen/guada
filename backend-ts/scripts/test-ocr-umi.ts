/**
 * UMI OCR 接口测试脚本
 * 直接调用 UMI OCR API 并打印原始响应，用于排查 OCR 结果为空的问题
 *
 * 用法: npx ts-node scripts/test-ocr-umi.ts <pdf路径>
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
  console.log("UMI OCR 接口测试");
  console.log("=".repeat(80));
  console.log(`文件: ${filePath}`);
  console.log(`服务: ${BASE_URL}`);
  console.log("");

  // 1. 上传 PDF
  console.log("--- 1. 上传 PDF ---");
  const filename = path.basename(filePath);
  const fileData = await fs.promises.readFile(filePath);

  const form = new FormData();
  form.append("file", fileData, { filename, contentType: "application/pdf" });
  form.append(
    "json",
    JSON.stringify({
      "ocr.language": "简体中文",
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
  const maxPolls = 120; // 最多等60秒

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

    console.log(`[轮询 #${pollCount}] 状态码: ${resultResp.status}`);

    if (pollCount === 1) {
      // 只在第一次打印完整结构
      console.log(
        "原始响应:",
        JSON.stringify(resultResp.data, null, 2).slice(0, 3000),
      );
    }

    const result = resultResp.data;

    // 关键：打印 data 的类型和结构
    console.log(`  code: ${result.code}`);
    console.log(`  data 类型: ${typeof result.data}`, Array.isArray(result.data) ? "(Array)" : "");
    console.log(`  data 长度: ${Array.isArray(result.data) ? result.data.length : "N/A"}`);
    console.log(`  is_done: ${result.is_done}`);
    console.log(`  state: ${result.state}`);
    console.log(`  pages_count: ${result.pages_count}`);
    console.log(`  processed_count: ${result.processed_count}`);

    // 打印 data 中的每个元素的结构
    if (Array.isArray(result.data)) {
      result.data.forEach((item: any, idx: number) => {
        console.log(`  data[${idx}]:`);
        console.log(`    page: ${item.page}`);
        console.log(`    data 类型: ${typeof item.data}`, Array.isArray(item.data) ? "(Array)" : "");
        if (Array.isArray(item.data)) {
          console.log(`    data 长度: ${item.data.length}`);
          item.data.forEach((d: any, di: number) => {
            console.log(`    data[${idx}].data[${di}]:`, JSON.stringify(d).slice(0, 200));
          });
        } else {
          // 如果不是数组，打印原始值
          console.log(`    data 原始值:`, JSON.stringify(item.data).slice(0, 500));
        }
      });
    } else {
      // 如果 data 不是数组，打印原始值
      console.log(`  data 原始值:`, JSON.stringify(result.data).slice(0, 1000));
    }

    if (result.is_done) {
      isDone = true;
      console.log("");

      if (result.state === "success") {
        console.log("--- 3. 识别成功 ---");
        // 重新读取一次完整结果（不传 is_unread 以获取全部数据）
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
        console.log("完整结果:", JSON.stringify(finalResp.data, null, 2).slice(0, 5000));
        console.log("总字符数:", JSON.stringify(finalResp.data).length);
      } else {
        console.log("--- 3. 识别失败 ---");
        console.log("错误信息:", result.message);
      }
    }
    console.log("");
  }

  // 4. 清理任务
  console.log("--- 4. 清理任务 ---");
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
  console.error("用法: npx ts-node scripts/test-ocr-umi.ts <pdf路径>");
  console.error("提示: 可以用 scripts/test-ocr-umi.ts 测试内置测试文件");
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