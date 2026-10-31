//! DewSecure 联邦学习聚合服务器

use axum::{
    extract::State,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

mod federation;
mod license;

use federation::aggregator::FederatedAggregator;
use license::LicenseStore;

/// 应用状态
#[derive(Clone)]
pub struct AppState {
    pub aggregator: Arc<RwLock<FederatedAggregator>>,
    pub licenses: Arc<RwLock<LicenseStore>>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let state = AppState {
        aggregator: Arc::new(RwLock::new(FederatedAggregator::new())),
        licenses: Arc::new(RwLock::new(LicenseStore::new())),
    };

    let app = Router::new()
        .route("/health", get(health))
        // 🛑 S-10 物理熔断：生产环境下线所有无鉴权的实验性接口 (federation/license)
        // 未来完成 TLS、身份认证、鲁棒聚合后，再通过环境变量开启
        // .route("/api/federation/submit", post(submit_gradients))
        // .route("/api/federation/global", get(get_global_model))
        // .route("/api/license/verify", post(verify_license))
        // .route("/api/model/version", get(model_version))
        .with_state(state);

    let addr = "0.0.0.0:8080";
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    tracing::info!("DewSecure 服务器启动于 {}", addr);
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "dewsecure",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

#[derive(Debug, Deserialize)]
struct GradientSubmission {
    client_id: String,
    num_samples: usize,
    gradients: Vec<f32>,
}

async fn submit_gradients(
    State(state): State<AppState>,
    Json(submission): Json<GradientSubmission>,
) -> impl IntoResponse {
    tracing::info!(
        "收到来自客户端 {} 的梯度 ({} 样本)",
        submission.client_id,
        submission.num_samples
    );

    let mut agg = state.aggregator.write().await;
    agg.add_client_update(
        submission.client_id,
        submission.num_samples,
        submission.gradients,
    );

    Json(serde_json::json!({ "ok": true }))
}

async fn get_global_model(State(state): State<AppState>) -> impl IntoResponse {
    let agg = state.aggregator.read().await;
    let global = agg.get_global_model();
    Json(serde_json::json!({
        "version": agg.version(),
        "weights": global,
    }))
}

async fn model_version(State(state): State<AppState>) -> impl IntoResponse {
    let agg = state.aggregator.read().await;
    Json(serde_json::json!({ "version": agg.version() }))
}

#[derive(Debug, Deserialize)]
struct LicenseRequest {
    email: String,
}

#[derive(Debug, Serialize)]
struct LicenseResponse {
    valid: bool,
    download_token: Option<String>,
    expires_at: Option<String>,
}

async fn verify_license(
    State(state): State<AppState>,
    Json(req): Json<LicenseRequest>,
) -> impl IntoResponse {
    let licenses = state.licenses.read().await;
    match licenses.verify(&req.email) {
        Some(license) => Json(LicenseResponse {
            valid: true,
            download_token: Some(uuid::Uuid::new_v4().to_string()),
            expires_at: Some(license.expires_at.to_rfc3339()),
        }),
        None => Json(LicenseResponse {
            valid: false,
            download_token: None,
            expires_at: None,
        }),
    }
}
