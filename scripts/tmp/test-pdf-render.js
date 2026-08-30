/**
 * 验证 pdfjs-dist + @napi-rs/canvas 在 Node 端渲染 PDF 页面为 PNG
 */
const path = require("path");
const fs = require("fs");

const pdfPath = path.join(__dirname, "test-render.pdf");
const outPath = path.join(__dirname, "test-render-output.png");

const PDFJS_PATH = "file:///D:/AI/ai_chat/backend-ts/node_modules_production/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
const CANVAS_PATH = "D:/AI/ai_chat/backend-ts/node_modules_production/node_modules/@napi-rs/canvas/index.js";
// Node 环境：pdfjs-dist 直接用 fs.readFile(baseUrl + filename)，所以要用本地路径而非 file:// URL
const STD_FONTS_URL = "D:/AI/ai_chat/backend-ts/node_modules_production/node_modules/pdfjs-dist/standard_fonts/";

async function main() {
  console.time("total");
  const pdfjsLib = await import(PDFJS_PATH);
  const { createCanvas, Path2D } = require(CANVAS_PATH);
  // pdfjs-dist 渲染文本需要全局 Path2D（浏览器里是 DOM 提供的）
  globalThis.Path2D = Path2D;

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, standardFontDataUrl: STD_FONTS_URL }).promise;
  console.log("PDF pages:", doc.numPages);

  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  console.log(`Page size: ${viewport.width} x ${viewport.height} (scale 1.5)`);

  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");

  // 方法1: 显式传入 canvasContext 渲染
  await page.render({ canvasContext: ctx, viewport }).promise;
  console.log("Render OK (explicit canvasContext)");

  const png = canvas.toBuffer("image/png");
  fs.writeFileSync(outPath, png);
  console.log("PNG written:", outPath, (png.length / 1024).toFixed(1) + " KB");

  // 方法2: 使用 pdfjs-dist 默认的 NodeCanvasFactory（内部就是 @napi-rs/canvas）
  // 注意：legacy build 未导出 NodeCanvasFactory，但 pdfjs-dist 已默认使用它
  console.log("NodeCanvasFactory exported:", "NodeCanvasFactory" in pdfjsLib);
  page.cleanup();
  console.timeEnd("total");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
