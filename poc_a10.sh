#!/bin/bash
cd ~/dewsecure
PASS=0; FAIL=0
ok(){ echo "  [PASS] $1"; PASS=$((PASS+1)); }
no(){ echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "== POC-1 静态代码验证 =="
grep -q "BlockPhishing" core/src/engine_host.rs && ok "BlockPhishing 枚举已添加" || no "BlockPhishing 缺失"
grep -q "BlockTracker => self.enable_tracker" core/src/matcher.rs && ok "剥离了错误的 AI 钓鱼开关映射" || no "开关映射未修复"
grep -q "ai_phishing_heuristic" core/src/matcher.rs && ok "钓鱼启发式检测已接入 should_block" || no "启发式检测未接入"
grep -q "localtime_r" core/src/stats.rs && ok "统计模块已改用本地时间" || no "统计模块未修复"
grep -q "mark_failed" core/src/vpn/device.rs && ok "device.rs 已接入 bypass 学习" || no "bypass 死代码未修复"
grep -q "匿名设备指纹与脱敏的可疑域名" docs/architecture.md && ok "文档隐私声明已更新" || no "文档未更新"

echo ""
echo "== POC-2 Rust 引擎真实逻辑测试 =="
mkdir -p core/tests
cat > core/tests/a10_poc.rs <<'RS'
use dewsecure_core::{HostEngine, EngineConfig, BlockDecision};

#[test]
fn test_a10_phishing_heuristic() {
    let config = EngineConfig { 
        rule_data: "".into(), 
        model_path: "".into(), 
        ai_enabled: true, 
        base_dir: "".into() 
    };
    let engine = HostEngine::new(config).expect("引擎初始化失败");

    // 默认 enable_ai_phishing 为 true，应拦截高特征钓鱼域名
    let res = engine.should_block("login-verify-update.xyz".to_string());
    assert_eq!(res.decision, BlockDecision::BlockPhishing, "A-10 修复失败：钓鱼域名未被拦截");
    assert_eq!(res.reason, "ai_phishing_heuristic");

    // 关闭开关，应放行
    engine.set_enable_ai_phishing(false);
    let res2 = engine.should_block("login-verify-update.xyz".to_string());
    assert_eq!(res2.decision, BlockDecision::Allow, "A-10 修复失败：关闭开关后仍拦截");
    println!("✅ 引擎钓鱼检测 POC 通过");
}
RS

# 运行测试
cargo test -p dewsecure_core --test a10_poc --quiet
if [ $? -eq 0 ]; then
    ok "Rust 引擎钓鱼检测逻辑运行通过"
else
    no "Rust 引擎钓鱼检测逻辑失败"
fi

rm core/tests/a10_poc.rs

echo ""
echo "===================================="
echo "结果：PASS=$PASS  FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
    echo "✅ 静态与动态验证通过。"
    echo "⚠️  请进行 POC-3 手机端真机复测："
    echo "    1. 编译 Android 安装包并安装：cd android && ./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk"
    echo "    2. 清空日志并开启 VPN：adb logcat -c"
    echo "    3. 手机浏览器访问：http://login-verify-update.xyz"
    echo "    4. 查看拦截日志：adb logcat -d | grep 'ai_phishing'"
    echo "    预期看到：[DNS拦截] 阻断 login-verify-update.xyz: ai_phishing_heuristic"
else
    echo "❌ 存在未通过项"
fi
