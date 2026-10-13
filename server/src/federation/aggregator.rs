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
    pub fn add_client_update(&mut self, client_id: String, num_samples: usize, gradients: Vec<f32>) {
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
            let weight = update.num_samples as f32 / total_samples as f32;
            for (i, g) in update.gradients.iter().enumerate() {
                if i < dim {
                    aggregated[i] += g * weight;
                }
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
