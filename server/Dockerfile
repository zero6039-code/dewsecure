FROM rust:1.80-slim AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY core ./core
COPY server ./server

RUN cargo build --release --bin dewsecure-server

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/dewsecure-server /usr/local/bin/

EXPOSE 8080
CMD ["dewsecure-server"]
