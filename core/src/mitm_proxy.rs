use hudsucker::{
    certificate_authority::RcgenAuthority,
    Proxy,
    Body, HttpContext, HttpHandler, RequestOrResponse,
    rcgen::{CertificateParams, KeyPair, DistinguishedName, DnType, IsCa, BasicConstraints, KeyUsagePurpose},
};
use std::net::SocketAddr;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use rustls::crypto::aws_lc_rs;
use hyper::Request;

static CA_CERT_PEM: OnceLock<String> = OnceLock::new();
static PROXY_STARTED: AtomicBool = AtomicBool::new(false);
static CA_KEY_PEM: OnceLock<String> = OnceLock::new();

// 一个最简单的透传 Handler，不做任何修改，让 hudsucker 自己转发
#[derive(Clone)]
struct DewProxyHandler;

impl HttpHandler for DewProxyHandler {
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        // 直接放行请求，hudsucker 会自动将其转发到上游服务器
        RequestOrResponse::Request(req)
    }
}

pub struct MitmProxy {
    _priv: (),
}

impl MitmProxy {
    pub fn new() -> Self {
        Self { _priv: () }
    }

    pub fn get_ca_cert_pem() -> String {
        if let Some(cert) = CA_CERT_PEM.get() {
            return cert.clone();
        }
        
        let (key_pair, params) = Self::generate_ca_params();
        
        match params.self_signed(&key_pair) {
            Ok(cert) => {
                let pem = cert.pem();
                let _ = CA_CERT_PEM.set(pem.clone());
                let _ = CA_KEY_PEM.set(key_pair.serialize_pem());
                pem
            }
            Err(e) => {
                println!("❌ 生成自签名证书失败: {:?}", e);
                String::new()
            }
        }
    }

    fn generate_ca_params() -> (KeyPair, CertificateParams) {
        let mut params = CertificateParams::default();
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, "DewSecure Personal CA");
        dn.push(DnType::OrganizationName, "DewSecure");
        params.distinguished_name = dn;
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        
        params.not_before = hudsucker::rcgen::date_time_ymd(2024, 1, 1);
        params.not_after = hudsucker::rcgen::date_time_ymd(2034, 1, 1);
        
        let key_pair = KeyPair::generate().expect("Failed to generate key pair");
        (key_pair, params)
    }

    pub async fn start(&self) -> Result<(), String> {
        println!("🚀 开始启动 MitM 代理...");

        let cert_pem = Self::get_ca_cert_pem();
        let key_pem = match CA_KEY_PEM.get() { Some(k) => k.clone(), None => return Err("私钥未初始化".to_string()) };
        if cert_pem.is_empty() {
            return Err("证书为空".to_string());
        }
        
        let key_pair = match KeyPair::from_pem(&key_pem) { Ok(k) => k, Err(_) => return Err("私钥解析失败".to_string()) };
        let mut params = CertificateParams::default();
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, "DewSecure Personal CA");
        dn.push(DnType::OrganizationName, "DewSecure");
        params.distinguished_name = dn;
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        params.not_before = hudsucker::rcgen::date_time_ymd(2024, 1, 1);
        params.not_after = hudsucker::rcgen::date_time_ymd(2034, 1, 1);
        let cert = match params.self_signed(&key_pair) { Ok(c) => c, Err(_) => return Err("自签名失败".to_string()) };

        let crypto_provider = aws_lc_rs::default_provider();
        let ca = RcgenAuthority::new(key_pair, cert, 1024, crypto_provider);

        let addr = SocketAddr::from(([127, 0, 0, 1], 8888));
        let proxy = Proxy::builder()
            .with_addr(addr)
            .with_ca(ca)
            .with_rustls_client(aws_lc_rs::default_provider())
            .with_http_handler(DewProxyHandler) // 使用正确的空 Handler
            .build();

        if let Ok(proxy) = proxy {
            if PROXY_STARTED.swap(true, Ordering::SeqCst) {
                return Ok(()); // 已经启动过，直接返回成功
            }
            tokio::spawn(async move {
                if let Err(_e) = proxy.start().await {
                    // 这里不再用 println，因为无法输出到 Android
                }
            });
            Ok(())
        } else {
            Err("Proxy 构建失败".to_string())
        }
    }
}
