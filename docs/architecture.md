# DewSecure 架构文档

## 概述

DewSecure 采用双引擎 AI 架构：
- **设备端轻量分类器**：实时决策，推理延迟 < 5ms，模型通过 Ed25519 验签后 OTA 更新。
- **云端联邦学习聚合器**（规划中）：目标为持续进化且保护隐私。

## 组件

### 核心引擎 (core/)

Rust 编写的跨平台引擎，通过 UniFFI 导出为 Kotlin/Swift 绑定。

主要模块：
- `rule_matcher`：Adblock 语法规则解析和高效匹配
- `classifier`：特征提取和 AI 分类
- `model_loader`：模型加载（支持 TFLite/ONNX/CoreML）
- `anti_bypass`：反反拦截 Scriptlet 变异

### 浏览器扩展 (extensions/)

- **Chrome**：基于 Manifest V3 + declarativeNetRequest
- **Firefox**：基于 webRequest.filterResponseData

### Android 完整版 (android/)

基于 VpnService 的本地拦截，不依赖 Root。

### 服务器 (server/)

联邦学习聚合服务（规划中，当前使用 FedAvg 算法做离线模拟）。

## 数据流
用户请求 → 规则匹配 → AI 分类器 → 决策
↓
拦截统计上报（可选，严格脱敏，不上传完整 URL）
↓
模型 OTA 更新 → CDN 分发

## 隐私设计

- 原始数据不出设备
- 联邦学习计划引入差分隐私和安全聚合（开发中）
- 模型权重传输使用 Ed25519 签名防篡改
