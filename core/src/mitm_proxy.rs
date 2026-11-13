use hudsucker::{
    certificate_authority::RcgenAuthority,
    Proxy,
    rcgen::{CertificateParams, KeyPair, DistinguishedName, DnType, IsCa, BasicConstraints, KeyUsagePurpose},
};
use std::net::SocketAddr;
use std::sync::OnceLock;
use rustls::crypto::aws_lc_rs;
use std::fs;
use std::path::PathBuf;
use log::info;

static CA_CERT_PEM: OnceLock<String> = OnceLock::new();
static CA_KEY_PEM: OnceLock<String> = OnceLock::new();
static BASE_DIR: OnceLock<String> = OnceLock::new();

pub fn set_base_dir(dir: String) {
    let _ = BASE_DIR.set(dir);
}

pub struct MitmProxy {
    _priv: (),
}

impl MitmProxy {
    pub fn new() -> Self {
        Self { _priv: () }
    }

    fn cert_path() -> Option<PathBuf> {
        BASE_DIR.get().map(|d| PathBuf::from(d).join("dewsecure_ca.pem"))
    }

    fn key_path() -> Option<PathBuf> {
        BASE_DIR.get().map(|d| PathBuf::from(d).join("dewsecure_ca_key.pem"))
    }

    pub fn get_ca_cert_pem() -> String {
        if let Some(cert) = CA_CERT_PEM.get() {
            return cert.clone();
        }

        // 1. 优先读取本地文件
        if let Some(cert_path) = Self::cert_path() {
            if cert_path.exists() {
                if let Ok(pem) = fs::read_to_string(&cert_path) {
                    if let Some(key_path) = Self::key_path() {
                        if key_path.exists() {
                            if let Ok(key_pem) = fs::read_to_string(&key_path) {
                                let _ = CA_CERT_PEM.set(pem.clone());
                                let _ = CA_KEY_PEM.set(key_pem);
                                info!("✅ 从本地文件加载 CA 证书");
                                return pem;
                            }
                        }
                    }
                }
            }
        }

        // 2. 文件不存在，生成新的并保存
        let (key_pair, params) = Self::generate_ca_params();
        match params.self_signed(&key_pair) {
            Ok(cert) => {
                let pem = cert.pem();
                let key_pem = key_pair.serialize_pem();
                
                if let Some(cert_path) = Self::cert_path() {
                    let _ = fs::write(&cert_path, &pem);
                }
                if let Some(key_path) = Self::key_path() {
                    let _ = fs::write(&key_path, &key_pem);
                }
                
                let _ = CA_CERT_PEM.set(pem.clone());
                let _ = CA_KEY_PEM.set(key_pem);
                info!("✅ 已生成新的 CA 证书并保存到本地文件");
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
        info!("🚀 启动 MitM 代理...");

        let cert_pem = Self::get_ca_cert_pem();
        if cert_pem.is_empty() {
            return Err("证书为空".to_string());
        }
        let key_pem = CA_KEY_PEM.get().expect("Key not initialized").clone();
        
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
            .build();

        if let Ok(proxy) = proxy {
            info!("✅ hudsucker 代理构建成功，监听 {}", addr);
            tokio::spawn(async move {
                if let Err(e) = proxy.start().await {
                    println!("❌ MitM 代理运行异常: {:?}", e);
                }
            });
            Ok(())
        } else {
            Err("Proxy 构建失败".to_string())
        }
    }
}
