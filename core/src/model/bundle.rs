//! 模型签名验签（纯函数，无网络/IO 依赖）。
//!
//! 协议严格对齐 `extensions/chrome/src/background/modelManager.js`：
//!
//! - **消息**：`"{version}:{sha256_hex}"`
//! - **算法**：Ed25519（对消息签名）、SHA-256（对 body 哈希）
//! - **公钥**：硬编码，与 JS 的 `ED25519_PUBLIC_KEY_HEX` 一致
//! - **版本单调**：`parseVer(remote) > parseVer(local)`，`parseVer` 提取首个数字串
//! - **失败语义**：与 JS 一致，任何一步失败即返回错误（调用方决定是否保留旧缓存）
//!
//! 使用方（Kotlin）流程：
//! 1. 从 `GET https://api.dewsecure.com/api/download-model?format=json` 拿响应
//! 2. 从响应头取 `X-Model-Version` / `X-Model-Sha256` / `X-Model-Signature`
//! 3. 响应体作为 `body: &[u8]` 传入
//! 4. `verify(...)` 返回 Ok → 写入 App 私有目录；Err → 保留旧缓存
//!
//! 注意：本模块**不做头存在性检查**（那属于调用方），也不解析 JSON 内容
//! （验签通过后由调用方 `JSON.parse`）。

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

/// Ed25519 公钥（32 字节 hex），与 JS `modelManager.js` 的 `ED25519_PUBLIC_KEY_HEX` 一致。
///
/// 这是**公钥**，可以公开。决定"新模型是否可信"的秘密是私钥，
/// 私钥只在服务器签名机上，永不进入 APK / 扩展 / 仓库。
const ED25519_PUBLIC_KEY_HEX: &str =
    "259eab8b493845eb78e345a139584c6812272d7183c7da29f774dea2d443fe77";

/// 验签失败原因。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BundleError {
    /// 响应体为空
    EmptyBody,
    /// body 的 SHA-256 与声明的 sha256_hex 不一致
    HashMismatch,
    /// 远程版本 <= 本地版本（降级攻击）
    VersionDowngrade,
    /// Base64 签名解码失败，或长度不是 64 字节
    SignatureMalformed,
    /// Ed25519 验签失败
    SignatureInvalid,
    /// 公钥硬编码有误（不应发生，防御性检查）
    InvalidPublicKey,
}

/// 纯函数验签。不涉及网络、IO、auth。
///
/// 参数：
/// - `version`：服务器响应头 `X-Model-Version`（如 `"V42"`）
/// - `sha256_hex`：服务器响应头 `X-Model-Sha256`（64 字符 hex）
/// - `signature_b64`：服务器响应头 `X-Model-Signature`（Base64 编码 64 字节签名）
/// - `body`：模型 JSON 原始字节
/// - `local_version`：本地已缓存版本（首次下载为 `None`）
///
/// 检查顺序（贴近 JS 行为）：
/// 1. body 非空
/// 2. 版本单调（`local_version` 存在时）
/// 3. body 的 SHA-256 与 `sha256_hex` 一致
/// 4. Ed25519 验签
pub fn verify(
    version: &str,
    sha256_hex: &str,
    signature_b64: &str,
    body: &[u8],
    local_version: Option<&str>,
) -> Result<(), BundleError> {
    // 1. body 非空
    if body.is_empty() {
        return Err(BundleError::EmptyBody);
    }

    // 2. 版本单调（仅当有本地版本时检查，与 JS 一致）
    if let Some(local) = local_version {
        let remote_seq = parse_ver(version);
        let local_seq = parse_ver(local);
        if remote_seq <= local_seq {
            return Err(BundleError::VersionDowngrade);
        }
    }

    // 3. SHA-256 校验
    let actual_hex = hex_encode(&sha256(body));
    if !constant_time_eq(actual_hex.as_bytes(), sha256_hex.to_lowercase().as_bytes()) {
        return Err(BundleError::HashMismatch);
    }

    // 4. Ed25519 验签
    // 消息 = "{version}:{sha256_hex}"，与 JS 的 `${remoteVersion}:${remoteSha256}` 一致
    let msg = format!("{}:{}", version, sha256_hex);

    let pubkey_bytes = hex_decode_32(ED25519_PUBLIC_KEY_HEX)
        .ok_or(BundleError::InvalidPublicKey)?;
    let verifying_key =
        VerifyingKey::from_bytes(&pubkey_bytes).map_err(|_| BundleError::InvalidPublicKey)?;

    let sig_bytes = B64
        .decode(signature_b64.trim())
        .map_err(|_| BundleError::SignatureMalformed)?;
    if sig_bytes.len() != 64 {
        return Err(BundleError::SignatureMalformed);
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let signature = Signature::from_bytes(&sig_arr);

    verifying_key
        .verify(msg.as_bytes(), &signature)
        .map_err(|_| BundleError::SignatureInvalid)?;

    Ok(())
}

// ───────── 内部工具 ─────────

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn hex_decode_32(hex: &str) -> Option<[u8; 32]> {
    let hex = hex.trim();
    if hex.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        let hi = u8::from_str_radix(&hex[i * 2..i * 2 + 1], 16).ok()?;
        let lo = u8::from_str_radix(&hex[i * 2 + 1..i * 2 + 2], 16).ok()?;
        out[i] = (hi << 4) | lo;
    }
    Some(out)
}

/// 与 JS 的 `parseVer` 一致：提取首个数字串，无数字返回 0。
///
/// 例：`"V42"` → 42，`"42"` → 42，`"abc"` → 0，`"abc123def456"` → 123
fn parse_ver(v: &str) -> u64 {
    let mut started = false;
    let mut num_str = String::new();
    for c in v.chars() {
        if c.is_ascii_digit() {
            started = true;
            num_str.push(c);
        } else if started {
            break;
        }
    }
    num_str.parse().unwrap_or(0)
}

/// 常量时间比较，防时序侧信道（hex 是敏感值）。
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

// ───────── 测试 ─────────

#[cfg(test)]
mod tests {
    use super::*;

    // 生成测试用签名对（在 build 时静态生成，不依赖运行时 rng）
    // 注意：公钥是硬编码的真实公钥，测试需要用一个"能验签通过"的签名。
    // 由于我们无法伪造真实私钥的签名，测试拆成两类：
    //   1. 纯逻辑测试（parse_ver / hex / constant_time_eq）——不依赖签名
    //   2. 负向验签测试（无效签名 / 改 body / 改 version）——依赖真实公钥，只测"拒绝"

    #[test]
    fn parse_ver_matches_js() {
        assert_eq!(parse_ver("V42"), 42);
        assert_eq!(parse_ver("42"), 42);
        assert_eq!(parse_ver("v1"), 1);
        assert_eq!(parse_ver("abc"), 0);
        assert_eq!(parse_ver(""), 0);
        assert_eq!(parse_ver("abc123def456"), 123);
        assert_eq!(parse_ver("1.2.8"), 1);
    }

    #[test]
    fn empty_body_rejected() {
        let r = verify("V1", "00", "AA==", &[], None);
        assert_eq!(r, Err(BundleError::EmptyBody));
    }

    #[test]
    fn version_downgrade_rejected() {
        // body 非空，但版本降级 → 应该先返回 VersionDowngrade
        let body = b"{}";
        let r = verify("V2", "00", "AA==", body, Some("V2"));
        assert_eq!(r, Err(BundleError::VersionDowngrade));

        let r = verify("V1", "00", "AA==", body, Some("V2"));
        assert_eq!(r, Err(BundleError::VersionDowngrade));
    }

    #[test]
    fn version_upgrade_passes_version_check() {
        // 版本升序时，应该往下走，卡在哈希检查
        let body = b"{}";
        let r = verify("V3", "00", "AA==", body, Some("V2"));
        assert_eq!(r, Err(BundleError::HashMismatch));
    }

    #[test]
    fn first_download_skips_version_check() {
        // local_version = None 时不做版本检查，直接进哈希
        let body = b"{}";
        let r = verify("V1", "00", "AA==", body, None);
        assert_eq!(r, Err(BundleError::HashMismatch));
    }

    #[test]
    fn hash_mismatch_rejected() {
        let body = b"hello";
        let r = verify("V1", "deadbeef", "AA==", body, None);
        assert_eq!(r, Err(BundleError::HashMismatch));
    }

    #[test]
    fn hash_match_proceeds_to_signature() {
        let body = b"hello";
        let real_sha = hex_encode(&sha256(body));
        // 哈希匹配了，但签名是垃圾 → 签名失败
        let r = verify("V1", &real_sha, "AAAA", body, None);
        // 分两种情况：AAA 不是 64 字节 → SignatureMalformed
        // 但 "AAAA" base64 解码是 3 字节 → SignatureMalformed
        assert_eq!(r, Err(BundleError::SignatureMalformed));
    }

    #[test]
    fn signature_wrong_length_rejected() {
        let body = b"hello";
        let real_sha = hex_encode(&sha256(body));
        // 3 字节 base64，不是 64 字节签名 → SignatureMalformed
        let r = verify("V1", &real_sha, "AAAA", body, None);
        assert_eq!(r, Err(BundleError::SignatureMalformed));
    }

    #[test]
    fn signature_64_bytes_but_invalid_rejected() {
        let body = b"hello";
        let real_sha = hex_encode(&sha256(body));
        // 用 B64.encode 保证解码后正好 64 字节（"A".repeat(88) 实际解出 66 字节）
        let zero_sig = B64.encode([0u8; 64]);
        let r = verify("V1", &real_sha, &zero_sig, body, None);
        // 64 字节但无效 → SignatureInvalid
        assert_eq!(r, Err(BundleError::SignatureInvalid));
    }

    #[test]
    fn invalid_base64_rejected() {
        let body = b"hello";
        let real_sha = hex_encode(&sha256(body));
        let r = verify("V1", &real_sha, "!!!notbase64!!!", body, None);
        assert_eq!(r, Err(BundleError::SignatureMalformed));
    }

    #[test]
    fn public_key_is_valid() {
        // 防御性检查：硬编码的公钥应能被解析
        let bytes = hex_decode_32(ED25519_PUBLIC_KEY_HEX);
        assert!(bytes.is_some(), "公钥 hex 应能解析成 32 字节");
        assert!(
            VerifyingKey::from_bytes(&bytes.unwrap()).is_ok(),
            "公钥应是合法的 Ed25519 点"
        );
    }

    #[test]
    fn constant_time_eq_basics() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(constant_time_eq(b"", b""));
    }
}
