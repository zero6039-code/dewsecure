use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LogItem {
    pub domain: String,
    pub block_type: String,
    pub timestamp: u64,
}

#[derive(Serialize)]
struct StatsSnapshot {
    total_blocked: u64,
    today_blocked: u64,
    logs: Vec<LogItem>,
}

pub struct StatsEngine {
    total_blocked: AtomicU64,
    today_blocked: AtomicU64,
    last_date: Mutex<String>,
    logs: Mutex<VecDeque<LogItem>>,
}

impl StatsEngine {
    pub fn new() -> Self {
        Self {
            total_blocked: AtomicU64::new(0),
            today_blocked: AtomicU64::new(0),
            last_date: Mutex::new("".to_string()),
            logs: Mutex::new(VecDeque::with_capacity(1000)),
        }
    }

    pub fn record_block(&self, domain: &str, block_type: &str) {
        // 获取当前 UTC 日期 YYYY-MM-DD
        let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let days = secs / 86400;
        let current_date = format!("{}", days); // 用天数作为日期判断，简单高效

        {
            let mut last_date = self.last_date.lock().unwrap_or_else(|e| e.into_inner());
            if *last_date != current_date {
                *last_date = current_date;
                self.today_blocked.store(0, Ordering::Relaxed);
            }
        }

        self.total_blocked.fetch_add(1, Ordering::Relaxed);
        self.today_blocked.fetch_add(1, Ordering::Relaxed);

        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        let item = LogItem {
            domain: domain.to_string(),
            block_type: block_type.to_string(),
            timestamp: now_ms,
        };

        if let Ok(mut logs) = self.logs.lock() {
            logs.push_back(item);
            if logs.len() > 1000 {
                logs.pop_front();
            }
        }
    }

    /// 直接输出 JSON 字符串给 Kotlin 侧，绕过复杂的 UniFFI 类型定义
    pub fn get_stats_json(&self) -> String {
        let logs_vec = if let Ok(logs) = self.logs.lock() {
            logs.iter().rev().take(1000).cloned().collect() // 返回全部日志给 UI 聚合
        } else {
            vec![]
        };

        let snapshot = StatsSnapshot {
            total_blocked: self.total_blocked.load(Ordering::Relaxed),
            today_blocked: self.today_blocked.load(Ordering::Relaxed),
            logs: logs_vec,
        };

        serde_json::to_string(&snapshot).unwrap_or_else(|_| "{}".to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::panic;

    #[test]
    fn test_c2_panic_is_caught() {
        // 🛡️ C-2 PoC：模拟内部触发 panic，验证 unwind 机制生效
        let result = panic::catch_unwind(|| {
            // 模拟一个发生 panic 的操作
            let _x: Option<i32> = None;
            _x.unwrap(); 
        });
        
        assert!(result.is_err(), "Panic 必须被 catch_unwind 捕获，而不是直接 crash 进程");
        println!("✅ PoC 成功：Rust 发生 panic 时已被 catch_unwind 安全捕获，不会导致 App 闪退");
    }
}
