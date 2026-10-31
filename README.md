# DewSecure
**Your device. Your rules.**

DewSecure is a user-side **Content Optimization and Security Engine** powered by an on-device AI classifier and cloud-based Federated Learning. Unlike traditional "ad blockers," DewSecure optimizes network resource loading based on user preferences, protecting users from malicious ads, phishing trackers, and intrusive pop-ups while ensuring absolute privacy.

> *"Traditional tools use yesterday's lists to block today's threats. We use AI to judge in real-time."*

## ⚖️ Legal & Compliance Positioning
- **Not an "Ad Blocker"**: Legally defined as a "User-side Content Optimization & Security Engine."
- **On-Device Decisions**: All filtering decisions are made autonomously by the AI on the user's device.
- **No Predefined Rules for Specific Platforms**: The engine is neutral, and users assume the risk of conflicts with website terms of service.
- **Privacy First**: Federated learning architecture ensures raw data never leaves the device.

## ✨ Key Features
- 🤖 **AI-Driven Interception**: Moving beyond manual filter lists to semantic URL classification.
- 🔒 **Federated Learning**: Continuous model improvement without compromising user privacy.
- 🚀 **Lightweight & Blazing Fast**: INT8 model < 50KB, parameter count < 1M, inference latency < 5ms.
- 🛡️ **Dual-Engine Architecture**: 
  - *Rule-based Layer*: 110,000+ high-efficiency DNR (Declarative Net Request) rules.
  - *AI Layer*: Deep learning for zero-day threats and unknown trackers.
- 🌍 **Cross-Platform**: Chrome / Firefox / Edge / Opera.
- 💰 **Affordable**: Premium tier at $11.99/year (less than $1/month).

*(Free = Clean browsing in the browser. Premium = System-wide security.)*

## 📊 Model Performance (v1.2.6 Cross-Browser)

### Current 3-Class Model (Normal / Ad / Tracker)
*Data leakage from keyword-based label generation has been eliminated. Metrics reflect true generalization.*

| Metric | Target | Actual | Status |
| :--- | ---: | ---: | :--- |
| **Macro F1** | 0.85 | **0.8583** | ✅ Real-world Ready |
| **Weighted F1** | 0.85 | **0.8610** | ✅ Good |
| **Tracker F1** | 0.80 | **0.8415** | ✅ Excellent |
| **Ad F1** | 0.85 | **0.8730** | ✅ Excellent |
| **Normal F1** | 0.85 | **0.8604** | ✅ Excellent |

*Note: The model is trained on a blended dataset of Disconnect.me, EasyPrivacy, and curated heuristic rules. Tracker labels now originate from independent sources to prevent feature leakage.*

### Historical Reference (Legacy 2-Class Model)
| Metric | Target | Actual | Status |
| :--- | ---: | ---: | :--- |
| **F1 Score** | 0.90 | 0.9690 | Deprecated |
| **AUC-ROC** | 0.95 | 0.9883 | Deprecated |

## 📁 Repository Structure
```text
dewsecure/
├── core/         # Rust core engine (High performance, cross-platform)
├── extensions/   # Chrome, Firefox, Edge, Opera extensions (MV3 + On-device ONNX)
├── models/       # AI Model training, evaluation, and conversion scripts
├── server/       # Federated learning aggregation service (FedAvg)
├── rules/        # DNR Filtering rulesets (Compiled & Optimized)
└── docs/         # Architecture & API documentation
🚀 CI/CD & Automation
Daily Model Training: Automated training pipeline (extracting latest threat intel and feedback), INT8 quantization, Ed25519 signing, and deployment to Cloudflare R2 for client-side OTA updates.

Automated Release: Multi-browser zip generation (Chrome, Firefox, Opera) via tagging.
