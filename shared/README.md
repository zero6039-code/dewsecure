# shared/ — DewSecure 跨端共享数据

## 真相源与消费链路

| 数据类型 | 真相源 | 消费者 |
|---|---|---|
| 特征常量 | `shared/*/constants.json` | JS（`constants-loader.js`）+ Rust（`build.rs` 生成） |
| 特征 schema | `shared/*/feature-schema.json` | 文档 + Rust 索引常量 |
| 模型权重 | Cloudflare R2（通过 `download-model` 端点） | JS（IndexedDB 缓存）+ Android（`bundle.rs` 验签后缓存） |
| 对拍夹具 | `shared/fixtures/*.json` | JS `test_consistency.js` + Rust `cargo test` |

**原始真相源是 Python**（`models/training/features.py`）。JS 和 Rust 都是推理侧复刻，
必须与 Python 的 `feature_test_vectors.json` 对齐。`shared/` 是这份对齐结果的落地点。
Python (models/training/features.py)
├──→ feature_test_vectors.json ──→ shared/fixtures/（抽样后）
└──→ 手工抽常量 ──→ shared/*/constants.json
│
┌───────────────┴───────────────┐
▼ ▼
extensions/chrome/src/ core/build.rs
（直接 import JSON） （生成 *_constants.rs）
│ │
▼ ▼
JS 推理端（现有） Rust 推理端（core/src/classifier/）
│
▼
android/ → .so → Kotlin EngineBridge

text

**规则**：改数据只改 `shared/`。JS 和 Rust 不允许自己定义常量或权重。

## ⚠️ fnv1a32 陷阱（必读）

`ai.js` 的 `fnv1a32` **不是标准 FNV-1a 32**：

| 实现 | offset basis | prime |
|---|---|---|
| 标准 FNV-1a 32 | `0x811c9dc5` | `0x01000193` |
| **`ai.js` 变体** | **`0x84222325`** | **`0x1b3`** |

Rust 侧**禁止**使用 `fnv::FnvHasher`，必须手写：

```rust
fn fnv1a32_variant(s: &str) -> u32 {
    let mut hash: u32 = 0x84222325;
    for b in s.bytes() {
        hash = (hash ^ b as u32).wrapping_mul(0x1b3);
    }
    hash
}
用错会全部特征错位。夹具对拍会红灯，但排查成本高，不如一开始就写对。

两条独立 Track
Track	输入	特征维度	对应 JS
T1 广告/追踪	域名	16418（16384 n-gram + 34 struct）	ai.js 的 extractSparseFeatures
T2 钓鱼	完整 URL	579（512 n-gram + 67 struct）	phishScoutFeatures.js 的 extractFeatures
两条 track 在 Rust 里必须是独立模块，不共享代码。
Android DNS 层只能拿 T1 的完整精度；T2 只能传 https://<domain>，
path/query 为空，精度低于浏览器侧。

模型权重
权重文件放在 Cloudflare R2，通过 modelManager.js 的 download-model 端点下载。
Rust 侧的验签逻辑（A2）按 modelManager.js 翻译：

公钥：259eab8b493845eb78e345a139584c6812272d7183c7da29f774dea2d443fe77

签名消息：`${version}:${sha256_hex}`（冒号不能变、顺序不能换）

HTTP 头：X-Model-Version / X-Model-Sha256 / X-Model-Signature / X-Model-Channel

版本单调：parseVer(remote) > parseVer(local)，parseVer 提取 V?(\d+)

失败策略：网络错误保留本地；401/403 清空；签名/哈希失败保留本地

权重 JSON schema：

json
{
  "coef": [ [16418 floats], [16418 floats], [16418 floats] ],
  "intercept": [3 floats]
}
类别顺序固定：[0]=Normal, [1]=Ad, [2]=Tracker。

MVP 阶段：开发时手动从 R2 下载一份放 android/app/src/main/assets/。
正式发布走 bundle.rs + R2（A2）。shared/weights/ 目录暂不建。

修改流程
改 shared/ 下的 JSON

JS 侧：node extensions/chrome/test_consistency.js 确认与 Python 一致

Rust 侧：cargo test 跑夹具，红灯则改 Rust 逻辑

两边绿灯后再合并

不允许：改 JS 或 Rust 里的常量而不改 shared/。
