# 部署指南

## 服务器部署

### 使用 Docker

```bash
docker build -t dewsecure-server -f server/Dockerfile .
docker run -d -p 8080:8080 --name dewsecure dewsecure-server
