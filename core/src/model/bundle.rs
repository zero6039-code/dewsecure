//! 模型签名验签（纯函数，无网络/IO 依赖）。

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};
use semver::Version;

const ED25519_PUBLIC_KEY_HEX: &str =
    "259eab8b493845eb78e345a139584c6812272d7183c7da29f774dea2d443fe77";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BundleError {
    EmptyBody,
    HashMismatch,
    VersionDowngrade,
    SignatureMalformed,
    SignatureInvalid,
    InvalidPublicKey,
    InvalidVersionFormat(String),
}

/// 纯函数验签。不涉及网络、IO、auth。
pub fn verify(
    version: &str,
    sha256_hex: &str,
    signature_b64: &str,
    body: &[u8],
    model_type: &str,
    channel: &str,
    valid_until: u64,
    local_version: Option<&str>,
) -> Result<(), BundleError> {
    // 1. body 非空
    if body.is_empty() {
        return Err(BundleError::EmptyBody);
    }

    // 2. 版本单调检查 (引入 semver 严格比较)
    if let Some(local) = local_version {
        let remote_ver = Version::parse(version).map_err(|_| BundleError::InvalidVersionFormat(version.to_string()))?;
        let local_ver = Version::parse(local).map_err(|_| BundleError::InvalidVersionFormat(local.to_string()))?;
        if remote_ver <= local_ver {
            return Err(BundleError::VersionDowngrade);
        }
    }

    // 3. SHA-256 校验
    let actual_hex = hex_encode(&sha256(body));
    if !constant_time_eq(actual_hex.as_bytes(), sha256_hex.to_lowercase().as_bytes()) {
        return Err(BundleError::HashMismatch);
    }

    // 4. Ed25519 验签 (🛡️ C-7 修复：加入 model_type, channel, valid_until)
    let msg = format!("dewsecure/model/v2\n{}\n{}\n{}\n{}\n{}", version, sha256_hex, model_type, channel, valid_until);

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

#[cfg(test)]
#[path = "bundle_test.rs"]
mod tests;
