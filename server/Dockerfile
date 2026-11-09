FROM rust:1.80-slim AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY core ./core
COPY server ./server

RUN cargo build --release --bin dewsecure-server

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
# 🛡️ C-12 修复：创建非特权用户
RUN useradd -m appuser
COPY --from=builder /app/target/release/dewsecure-server /usr/local/bin/

EXPOSE 8080
# 🛡️ C-12 修复：使用非 root 用户运行
USER appuser
CMD ["dewsecure-server"]
