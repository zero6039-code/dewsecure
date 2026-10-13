# DewSecure 架构文档

## 概述

DewSecure 采用双引擎 AI 架构：
- **设备端轻量分类器**：实时决策，推理延迟 < 5ms
- **云端联邦学习聚合器**：持续进化，原始数据不出设备

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

联邦学习聚合服务，使用 FedAvg 算法。

## 数据流
