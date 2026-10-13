//! 授权管理

use chrono::{DateTime, Duration, Utc};
use std::collections::HashMap;

pub struct License {
    pub email: String,
    pub expires_at: DateTime<Utc>,
    pub plan: String,
}

pub struct LicenseStore {
    licenses: HashMap<String, License>,
}

impl LicenseStore {
    pub fn new() -> Self {
        Self {
            licenses: HashMap::new(),
        }
    }

    /// 添加授权
    pub fn add(&mut self, email: String, plan: String, duration_days: i64) {
        let expires_at = Utc::now() + Duration::days(duration_days);
        self.licenses.insert(
            email.clone(),
            License {
                email,
                expires_at,
                plan,
            },
        );
    }

    /// 验证授权
    pub fn verify(&self, email: &str) -> Option<&License> {
        self.licenses
            .get(email)
            .filter(|l| l.expires_at > Utc::now())
    }

    /// 检查是否有效
    pub fn is_valid(&self, email: &str) -> bool {
        self.verify(email).is_some()
    }
}
