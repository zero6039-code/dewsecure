#!/usr/bin/env python3
# ==========================================
# 🛡️ AU-5: 情报生成安全闸
# 在发布前强制比对 Tranco 白名单、变更量限制等
# ==========================================
import json
import sys

def gate(new_domains, old_domains, tranco_top, max_delta=0.05):
    errs = []
    new_set = set(new_domains)
    old_set = set(old_domains)
    
    # 1) 与热门站点重叠一律拒绝（防止误杀头部网站）
    hit = [d for d in new_set if d in tranco_top]
    if hit: 
        errs.append(f'[Overlap] 包含 Tranco 前 N 的站点: {hit[:5]}')
        
    # 2) 变更量限制：一次增删超过上一版 5% 需人工确认
    delta = len(new_set ^ old_set) / max(len(old_set), 1)
    if delta > max_delta: 
        errs.append(f'[Delta] 变更量 {delta:.1%} 超过限制 {max_delta:.0%}')
        
    # 3) 格式与长度检查
    bad = [d for d in new_set if not (3 < len(d) < 254) or ' ' in d]
    if bad: 
        errs.append(f'[Malformed] 格式非法: {bad[:5]}')
        
    return errs

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: python3 intel_gate.py <new_intel.json> <old_intel.json> <tranco_top.txt>")
        sys.exit(1)
        
    try:
        new = json.load(open(sys.argv[1], 'r'))
        old = json.load(open(sys.argv[2], 'r'))
        top = set(l.strip() for l in open(sys.argv[3]) if l.strip())
    except Exception as e:
        print(f"❌ 文件读取失败: {e}")
        sys.exit(1)

    errs = gate(new, old, top)
    if errs: 
        print("\n".join(errs))
        sys.exit(1)
    print("✅ 情报安全闸校验通过")
