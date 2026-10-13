//! 反反拦截引擎
//!
//! 通过运行时行为模拟，绕过广告商的反拦截检测。

mod scriptlet;

pub use scriptlet::{generate_anti_bypass_script, generate_scriptlet};
