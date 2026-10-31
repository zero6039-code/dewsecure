//! 联邦平均聚合器

use std::collections::HashMap;

#[derive(Debug, Clone)]
struct ClientUpdate {
    num_samples: usize,
    gradients: Vec<f32>,
}

pub struct FederatedAggregator {
    updates: HashMap<String, ClientUpdate>,
    version: u64,
    global_model: Vec<f32>,
}

impl FederatedAggregator {
    pub fn new() -> Self {
        Self {
            updates: HashMap::new(),
            version: 0,
            global_model: Vec::new(),
        }
    }

    /// 添加客户端更新
    pub fn add_client_update(
        &mut self,
        client_id: String,
        num_samples: usize,
        gradients: Vec<f32>,
    ) {
        self.updates.insert(
            client_id,
            ClientUpdate {
                num_samples,
                gradients,
            },
        );

        // 当收到足够多的客户端更新时，进行聚合
        if self.updates.len() >= 10 {
            self.aggregate();
        }
    }

    /// 执行 FedAvg 聚合
    fn aggregate(&mut self) {
        if self.updates.is_empty() {
            return;
        }

        let total_samples: usize = self.updates.values().map(|u| u.num_samples).sum();
        if total_samples == 0 {
            return;
        }

        let dim = self.updates.values().next().unwrap().gradients.len();
        let mut aggregated = vec![0.0f32; dim];

        for update in self.updates.values() {
            // 🛡️ S-10 修复：跳过维度不匹配的恶意/异常更新
            if update.gradients.len() != dim {
                tracing::warn!("拦截异常梯度：维度不匹配");
                continue;
            }
            
            // 🛡️ S-10 修复：限制单次最高样本数，防止单点权重控制 (最高不能超过总样本数的 50%)
            let safe_samples = std::cmp::min(update.num_samples, total_samples / 2 + 1);
            let weight = safe_samples as f32 / total_samples as f32;

            for (i, &g) in update.gradients.iter().enumerate() {
                // 🛡️ S-10 修复：防御 NaN 与 Inf 投毒
                if !g.is_finite() {
                    tracing::warn!("拦截异常梯度：包含 NaN 或 Inf");
                    break; // 发现恶意数据，直接放弃这个客户端的更新
                }
                aggregated[i] += g * weight;
            }
        }

        self.global_model = aggregated;
        self.version += 1;
        self.updates.clear();

        tracing::info!("模型已聚合，版本 {}", self.version);
    }

    /// 获取全局模型
    pub fn get_global_model(&self) -> Vec<f32> {
        self.global_model.clone()
    }

    /// 获取版本号
    pub fn version(&self) -> u64 {
        self.version
    }
}
