#!/usr/bin/env bash
set -u
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
ng(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

LIB="core/src/lib.rs"
ENG="core/src/vpn/engine.rs"

echo "=== POC-A03 静态断言 ==="

# S1: 提前 send(Ok) 已消失
! grep -q 'tx.send(Ok::<(), String>' "$LIB" \
  && ok "S1 不再提前 send(Ok)" || ng "S1 提前 send 仍存在"

# S2: 使用带容量的 sync_channel
grep -q 'sync_channel::<Result<(), String>>(1)' "$LIB" \
  && ok "S2 sync_channel 容量 1" || ng "S2 sync_channel 缺失"

# S3: catch_unwind + AssertUnwindSafe
grep -q 'catch_unwind' "$LIB" && grep -q 'AssertUnwindSafe' "$LIB" \
  && ok "S3 线程 panic 捕获" || ng "S3 panic 捕获缺失"

# S4: 返回值区分 OK / ERR / TIMEOUT
grep -q 'Ok(Err(e))' "$LIB" \
  && grep -q 'Err(_).*ERR: 启动超时\|ERR: 启动超时' "$LIB" \
  && grep -q 'format!("ERR: {}"' "$LIB" \
  && ok "S4 返回值三分支" || ng "S4 返回值分支不全"

# S5: engine.start 接收 ready_tx
grep -q 'ready_tx: Option<std::sync::mpsc::SyncSender<Result<(), String>>>' "$ENG" \
  && ok "S5 start 接收 ready_tx" || ng "S5 start 签名未改"

# S6: proxy 失败有 try_send(Err)
grep -A4 'hudsucker 启动失败' "$ENG" | grep -q 'try_send(Err' \
  && ok "S6 proxy 失败回传" || ng "S6 proxy 失败未回传"

# S7: 就绪点有 try_send(Ok)
grep -A3 'smoltcp 协议栈启动' "$ENG" | grep -q 'try_send(Ok(()))' \
  && ok "S7 就绪点回传" || ng "S7 就绪点未回传"

# S8: 启动调用方传入 Some(tx_clone)
grep -q 'engine.start(Some(tx_clone))' "$LIB" \
  && ok "S8 调用方传 tx_clone" || ng "S8 调用方未传 ready_tx"

echo "=== POC-A03 编译断言 ==="
if cargo build -p dewsecure-core --lib 2>&1 | grep -qE '^error'; then
  ng "cargo build 失败"
else
  ok "cargo build 通过"
fi

echo "=== 结果: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ] || exit 1
