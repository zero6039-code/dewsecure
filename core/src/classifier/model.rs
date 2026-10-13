//! 分类器模型加载和推理

use crate::classifier::features::extract_features;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ModelError {
    #[error("模型文件不存在: {0}")]
    NotFound(String),
    #[error("模型格式无效: {0}")]
    InvalidFormat(String),
    #[error("推理失败: {0}")]
    InferenceFailed(String),
}

/// 预测结果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prediction {
    Ad,
    Tracker,
    Normal,
}

/// 分类器
pub struct Classifier {
    /// 模型权重（逻辑回归系数）
    weights: Vec<f32>,
    /// 偏置
    bias: f32,
    /// 阈值
    threshold: f32,
}

impl Classifier {
    /// 从文件加载模型
    pub fn load(path: &str) -> Result<Self, ModelError> {
        // 在真实实现中，这里会加载 TFLite/ONNX 模型
        // 对于 MVP，我们使用内置的默认权重
        tracing::info!("加载分类器模型: {}", path);

        Ok(Self::default_model())
    }

    /// 使用默认权重（用于测试和冷启动）
    pub fn default_model() -> Self {
        // 这些权重在实际训练后会替换
        let mut weights = vec![0.0f32; crate::classifier::features::FEATURE_DIM];

        // 手动设置一些关键词特征的权重
        let offset = 16384;
        weights[offset + 9] = 2.0;   // "ad"
        weights[offset + 10] = 2.5;  // "track"
        weights[offset + 11] = 1.5;  // "analytics"
        weights[offset + 16] = 3.0;  // "doubleclick"
        weights[offset + 15] = 2.0;  // "pixel"

        Self {
            weights,
            bias: -1.0,
            threshold: 0.5,
        }
    }

    /// 预测
    pub fn predict(&self, features: &[f32]) -> Prediction {
        if features.len() != self.weights.len() {
            tracing::warn!("特征维度不匹配");
            return Prediction::Normal;
        }

        // 线性组合
        let mut score = self.bias;
        for (f, w) in features.iter().zip(self.weights.iter()) {
            score += f * w;
        }

        // Sigmoid 激活
        let prob = sigmoid(score);

        // 根据概率和特征决定分类
        if prob > self.threshold {
            // 区分广告和追踪器
            let offset = 16384;
            let tracker_score = features[offset + 10] * 2.5
                + features[offset + 11] * 1.5
                + features[offset + 15] * 2.0;

            if tracker_score > 2.0 {
                Prediction::Tracker
            } else {
                Prediction::Ad
            }
        } else {
            Prediction::Normal
        }
    }

    /// 从字节加载（用于从 CDN 下载的加密模型）
    pub fn from_bytes(data: &[u8]) -> Result<Self, ModelError> {
        if data.len() < 4 {
            return Err(ModelError::InvalidFormat("数据太短".to_string()));
        }

        // 简单格式：前 4 字节为权重数量，后续为 f32 权重
        let num_weights = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let expected_len = 4 + num_weights * 4;

        if data.len() < expected_len {
            return Err(ModelError::InvalidFormat("数据不完整".to_string()));
        }

        let mut weights = Vec::with_capacity(num_weights);
        for i in 0..num_weights {
            let offset = 4 + i * 4;
            let w = f32::from_le_bytes([
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
            ]);
            weights.push(w);
        }

        let bias = weights.pop().unwrap_or(0.0);

        Ok(Self {
            weights,
            bias,
            threshold: 0.5,
        })
    }
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_model() {
        let classifier = Classifier::default_model();
        let features = extract_features("https://doubleclick.net/ad");
        let result = classifier.predict(&features);
        assert!(matches!(result, Prediction::Ad | Prediction::Tracker));
    }

    #[test]
    fn test_normal_url() {
        let classifier = Classifier::default_model();
        let features = extract_features("https://example.com/page");
        let result = classifier.predict(&features);
        // 默认模型对普通 URL 应该返回 Normal
        assert!(matches!(result, Prediction::Normal));
    }
}
