import os
import re

def fix_a26():
    # 1. 清理 DewVpnService.kt 中的残留调用
    vpn_service_path = "android/app/src/main/java/com/dewsecure/android/vpn/DewVpnService.kt"
    with open(vpn_service_path, "r", encoding="utf-8") as f:
        code = f.read()

    # 删除 3 处调用
    code = code.replace("                        TcpDnsRelay.setUpstreamDns(upstreamDns)\n", "")
    code = code.replace("        TcpDnsRelay.setUpstreamDns(upstreamDns)\n", "")
    code = code.replace("        TcpDnsRelay.removeAll()\n", "")

    with open(vpn_service_path, "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ DewVpnService.kt 残留调用已移除")

    # 2. 删除死代码文件
    dead_files = [
        "android/app/src/main/java/com/dewsecure/android/vpn/DnsForwarder.kt",
        "android/app/src/main/java/com/dewsecure/android/vpn/DnsPacketCodec.kt",
        "android/app/src/main/java/com/dewsecure/android/vpn/TcpDnsRelay.kt",
        "android/app/src/main/java/com/dewsecure/android/vpn/TcpDnsSession.kt",
        "android/app/src/main/java/com/dewsecure/dns/DnsCache.kt",
        "android/app/src/main/java/com/dewsecure/android/vpn/VpnEntitlementHelper.kt",
        "android/app/src/main/java/com/dewsecure/android/policy/RootChecker.kt",
        "android/app/src/main/java/com/dewsecure/android/policy/CertificateChecker.kt"
    ]

    for f in dead_files:
        if os.path.exists(f):
            os.system(f"git rm {f}")
            print(f"🗑️ 已删除: {f}")

if __name__ == "__main__":
    fix_a26()
