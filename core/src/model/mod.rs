//! 模型相关模块。
//!
//! 当前：`bundle` 提供模型签名验签（Ed25519 + SHA-256 + 版本单调）。
//! 未来：`loader`（模型加载）、`downloader`（网络下载）等可在此扩展。

pub mod bundle;
