fn main() {
    // 告诉 Cargo：只要 udl 改了，就必须重新跑 build.rs
    println!("cargo:rerun-if-changed=src/dewsecure.udl");
    uniffi::generate_scaffolding("src/dewsecure.udl").unwrap();
}
