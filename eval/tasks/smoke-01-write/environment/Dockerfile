# 基础镜像刻意选已缓存的 debian:bookworm：不装任何包 → 构建秒级、零网络依赖。
FROM debian:bookworm

WORKDIR /app

# 注意：不预建 /app/output —— 让 agent 自己创建目录（这是任务的一部分）
