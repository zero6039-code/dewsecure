# DewSecure 构建编排

# 默认显示帮助
default:
    @just --list

# ============ 核心引擎 ============

# 构建核心引擎（本机）
build-core:
    cd core && cargo build --release

# 构建核心引擎（Android）
build-core-android:
    cd core && cargo build --release --target aarch64-linux-android
    cd core && cargo build --release --target x86_64-linux-android

# 构建核心引擎（iOS）
build-core-ios:
    cd core && cargo build --release --target aarch64-apple-ios

# 构建核心引擎（WASM）
build-core-wasm:
    cd core && cargo build --release --target wasm32-unknown-unknown

# ============ 浏览器扩展 ============

# 构建 Chrome 扩展
build-chrome:
    cd extensions/chrome && npm install && npm run build

# 构建 Firefox 扩展
build-firefox:
    cd extensions/firefox && npm install && npm run build

# 开发模式（Chrome）
dev-chrome:
    cd extensions/chrome && npm run dev

# ============ Android ============

# 构建 Android APK
build-android:
    cd android && ./gradlew assembleRelease

# 构建 Android Debug
build-android-debug:
    cd android && ./gradlew assembleDebug

# 生成 Kotlin 绑定
gen-kotlin:
    cd core && cargo run --bin uniffi-bindgen generate \
        --library target/release/libdewsecure_core.so \
        --language kotlin \
        --out-dir ../android/app/src/main/java/com/dewsecure/rust

# ============ iOS ============

# 生成 Swift 绑定
gen-swift:
    cd core && cargo run --bin uniffi-bindgen generate \
        --library target/release/libdewsecure_core.a \
        --language swift \
        --out-dir ../ios/DewSecure/Bindings

# ============ 模型 ============

# 安装 Python 依赖
install-ml:
    cd models && pip install -r training/requirements.txt

# 训练模型
train:
    cd models && python training/train.py

# 导出 ONNX
export-onnx:
    cd models && python conversion/to_onnx.py

# 导出 TFLite
export-tflite:
    cd models && python conversion/to_tflite.py

# ============ 测试 ============

# 运行 Rust 测试
test:
    cargo test --workspace

# 运行 Clippy
lint:
    cargo clippy --workspace -- -D warnings

# 格式化
fmt:
    cargo fmt --all

# ============ 服务器 ============

# 启动服务器
run-server:
    cd server && cargo run --release

# ============ 工具 ============

# 清理构建产物
clean:
    cargo clean
    rm -rf extensions/chrome/dist extensions/firefox/dist
    cd android && ./gradlew clean
