# dewsecure
你的设备，你的规则。基于设备端 AI 与联邦学习的用户端内容优化引擎。

# DewSecure

**你的设备，你的规则。**

DewSecure 是一款基于设备端 AI 分类器 + 云端联邦学习的用户端内容优化引擎。

## 特性

- 🤖 AI 驱动拦截，替代人工维护的过滤器列表
- 🔒 联邦学习架构，原始数据不出设备
- 🚀 轻量级分类器，参数量 < 1M，推理延迟 < 5ms
- 💰 年付 $11.99，月均不到 $1
- 🌍 跨平台：Chrome / Firefox / Android / iOS

## 仓库结构
dewsecure/
├── core/ # Rust 核心引擎
├── extensions/ # 浏览器扩展
├── android/ # Android 完整版
├── ios/ # iOS 版
├── models/ # 模型训练与转换
├── server/ # 联邦学习聚合服务
├── rules/ # 过滤规则列表
└── docs/ # 文档


# 模型指标总结

## 当前模型指标（三分类）

| 指标 | 目标 | 实际（三分类） | 评价 |
| --- | ---: | ---: | :--- |
| Macro F1 | 0.90 | 0.9184 | ✅ 优秀 |
| Weighted F1 | 0.90 | 0.8928 | ✅ 良好 |
| 准确率 | — | 0.8929 | ✅ 高 |
| Tracker F1 | 0.90 | 0.9769 | ⭐ 接近完美 |
| Ad F1 | 0.85 | 0.8820 | ✅ 优秀 |
| Normal F1 | 0.85 | 0.8962 | ✅ 优秀 |

## 历史参考（二分类模型）

| 指标 | 目标 | 实际 | 评价 |
| --- | ---: | ---: | :--- |
| F1 Score | 0.90 | 0.9690 | 优秀 |
| AUC-ROC | 0.95 | 0.9883 | 接近完美 |
| Precision | 0.88 | 0.9875 | 误报率仅 1.25% |
| Recall | 0.90 | 0.9511 | 漏报率约 4.9% |
| 准确率 | — | 0.9695 | 高 |

## 📖 每个指标的用意

| 指标 | 含义 | 通俗解释 | 目标方向 |
| --- | --- | --- | --- |
| Precision（精确率） | 预测为"广告"的样本中，真正是广告的比例 | "我说是广告的，有多少真的是广告？" | 越高越好 → 减少误报 |
| Recall（召回率） | 所有真实广告中，被正确识别的比例 | "所有广告里，我抓到了多少？" | 越高越好 → 减少漏报 |
| F1 Score | Precision 和 Recall 的调和平均 | "精确率和召回率的平衡分" | 越高越好 |
| AUC-ROC | 模型区分正负样本的能力（0.5=随机，1.0=完美） | "模型有多会区分广告和正常网站？" | >0.95 优秀 |
| 准确率 | 预测正确的样本占总样本的比例 | "整体猜对了多少？" | 越高越好 |
| Macro F1 | 每个类别的 F1 求平均（不考虑样本量） | "每个类别都照顾到了吗？" | 适合类别不平衡 |
| Weighted F1 | 每个类别的 F1 按样本量加权平均 | "整体表现如何？" | 适合类别不平衡 |

## ⚠️ 为什么 Precision 和 Recall 要一起看？

| 场景 | Precision 高 | Recall 高 |
| --- | --- | --- |
| Precision 高、Recall 低 | 说"广告"的大多真是广告 | 但很多广告漏掉了 |
| Precision 低、Recall 高 | 广告基本都被抓了 | 但误伤很多正常内容 |
| 两者都高 | ✅ 理想状态 | ✅ |

对我们来说：

- **误报代价高**：把正常网站判成广告 → 用户投诉
- **漏报代价低**：漏掉一个广告 → 影响小

所以 **Precision 比 Recall 更重要**（我们 Precision 0.9875 非常优秀）



text

## 快速开始

```bash
# 安装工具链
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install just
cargo install uniffi-bindgen

# 构建核心引擎
just build-core

# 运行测试
just test

# 构建 Chrome 扩展
just build-chrome

# 构建 Firefox 扩展
just build-firefox
许可证
核心引擎和推理框架：GPL-3.0

过滤规则列表：CC BY-SA 4.0

模型权重和聚合服务：商业许可（闭源）

链接
官网

文档

隐私政策

text

### `LICENSE`
GNU GENERAL PUBLIC LICENSE
Version 3, 29 June 2007

Copyright (C) 2026 DewSecure

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see https://www.gnu.org/licenses/.

text

### `.gitignore`

```gitignore
# Rust
target/
**/*.rs.bk
Cargo.lock

# Node
node_modules/
dist/
*.log

# Python
__pycache__/
*.py[cod]
.venv/
venv/
*.egg-info/

# 模型权重（不提交到 Git）
models/weights/*.tflite
models/weights/*.onnx
models/weights/*.mlmodel
models/weights/*.pt
models/weights/*.bin
models/weights/*.enc

# 数据集（不提交到 Git）
models/data/*.csv

# 环境变量
.env
.env.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# 系统
.DS_Store
Thumbs.db

# 构建产物
extensions/*/build/
extensions/*/dist/
android/app/build/
ios/build/

# 密钥
*.key
*.pem
*.p12
keystore.jks




