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

# 构建 Opera 扩展
build-opera:
    cd extensions/opera && npm install && npm run build

# 一键构建所有浏览器扩展 (Chrome -> Firefox/Opera 自动同步)
build-all-extensions: build-chrome
    cd extensions/firefox && node build.js
    cd extensions/opera && node build.js

# 开发模式（Chrome）
dev-chrome:
    cd extensions/chrome && npm run dev

# ============ Android ============

# 构建 Android APK
build-android:
    @if [ -d "android" ]; then @if [ -d "android" ]; then cd android && ./gradlew assembleRelease; else echo "⚠️ 未找到 android 目录，跳过构建"; fi; else echo "⚠️ 未找到 android 目录，跳过构建"; fi

# 构建 Android Debug
build-android-debug:
    @if [ -d "android" ]; then @if [ -d "android" ]; then cd android && ./gradlew assembleDebug; else echo "⚠️ 未找到 android 目录，跳过构建"; fi; else echo "⚠️ 未找到 android 目录，跳过构建"; fi

# 构建带 UniFFI 元数据的 core（供绑定生成使用）
# 注意：必须用 --profile uniffi；release 的 strip=true 会剥离元数据 section，导致 uniffi-bindgen --library 静默失败
build-uniffi:
    cd core && cargo build --profile uniffi

# 生成 Kotlin 绑定（依赖 build-uniffi；产物落到 com/dewsecure/core/）
gen-kotlin: build-uniffi
    cd core && cargo run --bin uniffi-bindgen generate \
        --library ../target/uniffi/libdewsecure_core.so \
        --language kotlin \
        --out-dir ../android/app/src/main/java

# ============ iOS ============

# 生成 Swift 绑定
gen-swift:
    cd core && cargo run --bin uniffi-bindgen generate \
        --library ../target/release/libdewsecure_core.a \
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
    rm -rf extensions/chrome/dist extensions/firefox/dist extensions/opera/dist
    @if [ -d "android" ]; then @if [ -d "android" ]; then cd android && ./gradlew clean; else echo "⚠️ 未找到 android 目录，跳过清理"; fi; else echo "⚠️ 未找到 android 目录，跳过清理"; fi
