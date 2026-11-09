//! 授权管理

use chrono::{DateTime, Duration, Utc};
use std::collections::HashMap;

pub struct License {
    pub email: String,
    pub license_key: String, // 🛡️ C-12 修复：增加授权密钥
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
    pub fn add(&mut self, email: String, license_key: String, plan: String, duration_days: i64) {
        let expires_at = Utc::now() + Duration::days(duration_days);
        self.licenses.insert(
            email.clone(),
            License {
                email,
                license_key,
                expires_at,
                plan,
            },
        );
    }

    /// 验证授权
    pub fn verify(&self, email: &str, license_key: &str) -> Option<&License> {
        self.licenses
            .get(email)
            .filter(|l| l.expires_at > Utc::now() && l.license_key == license_key)
    }

    /// 检查是否有效
    pub fn is_valid(&self, email: &str, license_key: &str) -> bool {
        self.verify(email, license_key).is_some()
    }
}
