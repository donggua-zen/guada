/**
 * 流式协议类型（前端本地单一事实来源）
 *
 * 与后端对应文件逐字段同构，供 StreamEventHub / streamProjector / useStreamResponse
 * 等流式消费方共享定义。将来做前后端共享包时，整个目录搬入
 * packages/shared/src/（content-block.types.ts → conversation/，其余 → stream/），
 * 消费方 import 路径从 "@/types/stream" 改为 "@guada/shared" 即可。
 */
export * from "./content-block.types";
export * from "./stream-chunk.types";
export * from "./event-chunk.types";