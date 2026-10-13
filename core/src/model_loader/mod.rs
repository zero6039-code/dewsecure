//! 模型加载器
//!
//! 支持从 CDN 下载加密模型并在设备端解密加载。

use crate::classifier::{Classifier, Prediction};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LoaderError {
    #[error("下载失败: {0}")]
    DownloadFailed(String),
    #[error("解密失败: {0}")]
    DecryptionFailed(String),
    #[error("模型加载失败: {0}")]
    LoadFailed(String),
}

/// 模型格式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelFormat {
    TFLite,
    ONNX,
    CoreML,
    Native,
}

/// 模型加载器
pub struct ModelLoader {
    format: ModelFormat,
    data: Vec<u8>,
}

impl ModelLoader {
    /// 从字节创建加载器
    pub fn from_bytes(data: Vec<u8>, format: ModelFormat) -> Self {
        Self { format, data }
    }

    /// 加载并返回分类器
    pub fn load_classifier(&self) -> Result<Classifier, LoaderError> {
        match self.format {
            ModelFormat::Native => {
                Classifier::from_bytes(&self.data)
                    .map_err(|e| LoaderError::LoadFailed(e.to_string()))
            }
            _ => {
                // 对于 TFLite/ONNX/CoreML，在真实实现中会调用对应的运行时
                // 这里简化为使用默认模型
                tracing::warn!("平台特定模型格式暂未实现，使用默认模型");
                Ok(Classifier::default_model())
            }
        }
    }
}
