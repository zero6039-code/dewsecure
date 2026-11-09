//! T1 广告/追踪线性模型（运行时加载 + 稀疏推理）
//!
//! 与 `extensions/chrome/src/background/ai.js` 的推理路径严格对齐：
//! - `coef`: 3 × 16418（class 0=Normal, 1=Ad, 2=Tracker）
//! - `intercept`: 3 维
//! - logits = intercept + Σ coef[class][idx] × feature[idx]
//! - softmax → argmax + max prob
//!
//! 置信度阈值（0.8）不在本模块判断，由 `HostEngine::should_block` 决定。
//! 本模块不依赖 UDL、不暴露给 Kotlin；A0-7 之后 Kotlin 通过
//! `HostEngine::set_adblock_model(json)` 运行时注入。

use crate::classifier::features_adblock::SparseFeatures;
use crate::engine_host::BlockDecision;
use serde::Deserialize;

const TOTAL_DIM: usize = 16418;
const N_CLASSES: usize = 3;

/// 线性分类器权重。
#[derive(Debug, Clone)]
pub struct AdblockModel {
    /// 3 × 16418
    coef: Vec<Vec<f32>>,
    /// 3 维
    intercept: Vec<f32>,
}

impl AdblockModel {
    /// 从已有的 `coef` / `intercept` 数组构造（测试与 `load_from_json` 共用）。
    pub fn from_arrays(coef: Vec<Vec<f32>>, intercept: Vec<f32>) -> Result<Self, String> {
        // 🛡️ C-8 修复：先检查外层维度，防止恶意 JSON 构造超大 Vec 撑爆内存
        if coef.len() != N_CLASSES {
            return Err(format!(
                "coef 应为 {} 个类别，实际 {}",
                N_CLASSES,
                coef.len()
            ));
        }
        if coef.iter().any(|c| c.len() > TOTAL_DIM) {
            return Err("coef 内部数组长度超过预设上限".to_string());
        }
        for (i, c) in coef.iter().enumerate() {
            if c.len() != TOTAL_DIM {
                return Err(format!(
                    "coef[{}] 维度应为 {}，实际 {}",
                    i, TOTAL_DIM, c.len()
                ));
            }
            if !c.iter().all(|v| v.is_finite()) {
                return Err(format!("coef[{}] 含 NaN/Infinity", i));
            }
        }
        if intercept.len() != N_CLASSES {
            return Err(format!(
                "intercept 应为 {} 维，实际 {}",
                N_CLASSES,
                intercept.len()
            ));
        }
        if !intercept.iter().all(|v| v.is_finite()) {
            return Err("intercept 含 NaN/Infinity".to_string());
        }
        Ok(Self { coef, intercept })
    }

    /// 从 JSON 加载。JSON 形如：
    /// `{ "coef": [[16418], [16418], [16418]], "intercept": [3] }`
    /// 与 `modelManager.js` 的 `isValidModelShape` 语义一致。
    pub fn load_from_json(json: &str) -> Result<Self, String> {
        // 🛡️ C-8 修复：硬性限制 4MB，防止反序列化时 OOM
        if json.len() > 4 * 1024 * 1024 {
            return Err("模型 JSON 超过 4MB 大小限制".to_string());
        }
        
        // 注意：反序列化操作应在锁外进行。
        #[derive(Deserialize)]
        struct Raw {
            coef: Vec<Vec<f32>>,
            intercept: Vec<f32>,
        }
        let raw: Raw =
            serde_json::from_str(json).map_err(|e| format!("JSON 解析失败: {}", e))?;
        Self::from_arrays(raw.coef, raw.intercept)
    }

    /// 稀疏推理：只遍历非零特征。
    /// 返回 (分类, softmax 最大概率)。
    pub fn predict(&self, features: &SparseFeatures) -> (BlockDecision, f32) {
        let mut logits = [self.intercept[0], self.intercept[1], self.intercept[2]];

        for (&bucket, &count) in &features.buckets {
            let idx = bucket as usize;
            if idx < TOTAL_DIM {
                logits[0] += self.coef[0][idx] * count;
                logits[1] += self.coef[1][idx] * count;
                logits[2] += self.coef[2][idx] * count;
            }
        }
        for &(abs_idx, val) in &features.structs {
            let idx = abs_idx as usize;
            if idx < TOTAL_DIM {
                logits[0] += self.coef[0][idx] * val;
                logits[1] += self.coef[1][idx] * val;
                logits[2] += self.coef[2][idx] * val;
            }
        }

        let probs = softmax3(logits);
        let max_class = argmax3(probs);
        let decision = match max_class {
            0 => BlockDecision::Allow,
            1 => BlockDecision::BlockAd,
            2 => BlockDecision::BlockTracker,
            _ => unreachable!(),
        };
        (decision, probs[max_class])
    }
}

fn softmax3(logits: [f32; 3]) -> [f32; 3] {
    let max = logits[0].max(logits[1]).max(logits[2]);
    let e = [
        (logits[0] - max).exp(),
        (logits[1] - max).exp(),
        (logits[2] - max).exp(),
    ];
    let sum = e[0] + e[1] + e[2];
    [e[0] / sum, e[1] / sum, e[2] / sum]
}

fn argmax3(xs: [f32; 3]) -> usize {
    if xs[0] >= xs[1] && xs[0] >= xs[2] {
        0
    } else if xs[1] >= xs[2] {
        1
    } else {
        2
    }
}
