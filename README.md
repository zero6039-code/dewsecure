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
  - *Rule-based Layer*: 110,000+ high-efficiency DNR rules compiled into an ultra-fast **FST (Finite State Transducer)** for microsecond-level lookups.
  - *AI Layer*: Deep learning for zero-day threats and unknown trackers.
- 🌍 **Cross-Platform**: System-wide protection on **Android**, plus Chrome / Firefox / Edge / Opera extensions.
- 💰 **Affordable**: Premium tier at $11.99/year (less than $1/month).

*(Free = Clean browsing in the browser. Premium = System-wide security on Android).*

## 🏗️ System Architecture & Tech Stack
- **Android Client (Kotlin + Rust)**:
  - **smoltcp Transparent Proxy**: Bypasses the system VPN bottlenecks with a custom user-space TCP/IP stack, achieving zero-copy, high-concurrency TUN packet processing.
  - **Commercial-Grade Security**: Supabase Auth integration, live Pro entitlements sync, Ed25519 signature verification, and instant OTA model hot-swapping.
  - **Seamless OAuth**: Chrome Custom Tabs with clean task-stack management for a closed-loop login experience.
- **Browser Extensions (MV3 + On-device ONNX)**: Lightweight WebAssembly/JS implementations sharing the exact same AI weights and DNR rulesets.
- **Cloud Pipeline (GitHub Actions + Cloudflare R2)**: Daily automated model training, quantization, signing, and secure CDN deployment.

## 📊 Model Performance (v1.2.6 Cross-Browser)
*Data leakage from keyword-based label generation has been eliminated. Metrics reflect true generalization capability.*

| Metric | Target | Actual | Status |
| :--- | ---: | ---: | :--- |
| **Macro F1** | 0.85 | **0.8710** | ✅ Production Ready |
| **Normal F1** | 0.85 | **0.8900** | ✅ High (Recall 0.94 - Zero False Positives) |
| **Ad F1** | 0.80 | **0.8300** | ✅ Excellent |
| **Tracker F1** | 0.85 | **0.8900** | ✅ Excellent (Precision 0.92) |

*Note: The model is trained on a rigorously cleaned dataset blending Disconnect.me, EasyPrivacy, and curated heuristics. It features a Golden Set validation pipeline to prevent data poisoning and ensure core domain safety.*

## 📁 Repository Structure
dewsecure/
├── core/         # Rust core engine (smoltcp proxy, FST rules, AI inference)
├── android/      # Android App (Kotlin UI, VpnService, Custom Tabs)
├── extensions/   # Browser extensions (MV3 + On-device ONNX)
├── models/       # AI Model training, evaluation, and conversion scripts
├── server/       # Federated learning aggregation service (FedAvg)
├── rules/        # DNR Filtering rulesets (Compiled & Optimized)
└── docs/         # Architecture & API documentation

## 🚀 CI/CD & Automation
- **Daily Model Training**: Automated pipeline extracting latest threat intel, INT8 quantization, Ed25519 signing, Golden Set validation, and deployment to Cloudflare R2 for client-side OTA updates.
- **Automated Release**: Multi-browser zip generation via tagging.
