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
- 🌍 **Cross-Platform**: Chrome / Firefox / Android / iOS.
- 💰 **Affordable**: Premium tier at $11.99/year (less than $1/month).

*(Free = Clean browsing in the browser. Premium = System-wide security.)*

## 📊 Model Performance (V1.0.0-stable)

### Current 3-Class Model (Normal / Ad / Tracker)
| Metric | Target | Actual | Status |
| :--- | ---: | ---: | :--- |
| **Macro F1** | 0.90 | **0.9185** | ✅ Excellent |
| **Weighted F1** | 0.90 | **0.8932** | ✅ Good |
| **Tracker F1** | 0.90 | **0.9760** | ⭐ Near Perfect |
| **Ad F1** | 0.85 | **0.8833** | ✅ Excellent |
| **Normal F1** | 0.85 | **0.8961** | ✅ Excellent |
| **Accuracy** | — | **0.8934** | ✅ High |

### Historical Reference (2-Class Model)
| Metric | Target | Actual | Status |
| :--- | ---: | ---: | :--- |
| **F1 Score** | 0.90 | 0.9690 | Excellent |
| **AUC-ROC** | 0.95 | 0.9883 | Near Perfect |
| **Precision** | 0.88 | 0.9875 | False positive rate: 1.25% |
| **Recall** | 0.90 | 0.9511 | False negative rate: 4.9% |

**Why Precision matters more than Recall for us:** A false positive (blocking normal content) causes severe user friction and support tickets. A false negative (missing an ad) is a minor inconvenience. Our Precision of 98.75% ensures a seamless, non-breaking browsing experience.

## 📁 Repository Structure
```text
dewsecure/
├── core/         # Rust core engine (High performance, cross-platform)
├── extensions/   # Chrome & Firefox extensions (MV3 + On-device ONNX)
├── android/      # Android full version (VpnService + TFLite)
├── ios/          # iOS version (Safari Extension + Core ML)
├── models/       # AI Model training, evaluation, and conversion scripts
├── server/       # Federated learning aggregation service (FedAvg)
├── rules/        # DNR Filtering rulesets (Compiled & Optimized)
└── docs/         # Architecture & API documentation
🚀 CI/CD & Automation
Weekly Rules Update: Automated pulling and conversion of EasyList to DNR JSON.

Weekly Model Training: Automated training pipeline (V{iteration}.{YYMMDD}) and deployment to Cloudflare R2 for client-side OTA updates.
