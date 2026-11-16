#!/usr/bin/env bash
set -u
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
ng(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "=== POC-A01 静态断言 ==="
# S1 验签失败不再 warn 继续
grep -q 'Ed25519 验签失败' core/src/rules.rs && ! grep -q '继续热更新' core/src/rules.rs \
  && ok "S1 验签失败不再降级" || ng "S1 降级逻辑仍存在"

# S2 无 unwrap 解码
! grep -E 'hex::decode\(ED25519_PUBLIC_KEY_HEX\)\.unwrap|BASE64\.decode\([^)]*\)\.unwrap|Signature::from_slice\([^)]*\)\.unwrap' core/src/rules.rs \
  && ok "S2 公钥/签名解码无 unwrap" || ng "S2 仍有 unwrap panic 风险"

# S3 被签消息绑定
grep -q 'msg_str.ends_with' core/src/rules.rs \
  && ok "S3 被签消息绑定 sha256" || ng "S3 绑定校验缺失"

# S4 原子写盘
grep -q 'fs::rename(&tmp_path' core/src/rules.rs \
  && ok "S4 原子写盘" || ng "S4 仍直接 fs::write"

# S5 载荷上限
grep -q '8 \* 1024 \* 1024' core/src/rules.rs \
  && ok "S5 载荷上限" || ng "S5 载荷上限缺失"

# S6 EngineBridge 不再 engine?.
! grep -q 'engine?.verifyAndUpdateRules' android/app/src/main/java/com/dewsecure/android/policy/EngineBridge.kt \
  && ok "S6 EngineBridge 消除 engine?. 伪成功" || ng "S6 伪成功仍在"

# S7 EngineBridge 空引擎返回 false
grep -q 'val eng = engine ?:' android/app/src/main/java/com/dewsecure/android/policy/EngineBridge.kt \
  && ok "S7 空引擎拒绝更新" || ng "S7 空引擎处理缺失"

echo "=== POC-A01 编译断言 ==="
if cargo build -p dewsecure-core --lib 2>&1 | grep -qE '^error'; then
  ng "cargo build 失败"
else
  ok "cargo build 通过"
fi

echo "=== 结果: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ] || exit 1
