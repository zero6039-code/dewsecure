//! AI 分类器接口
//!
//! 提供设备端轻量级分类器的加载和推理。

mod features;
mod model;

pub use features::extract_features;
pub use model::{Classifier, Prediction};
