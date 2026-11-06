import sys
import json
import os
import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--meta', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--min-macro-f1', type=float, default=0.90)
    parser.add_argument('--max-drop', type=float, default=0.01)
    args = parser.parse_args()

    # 1. 读取指标
    with open(args.meta) as f: current = json.load(f)
    with open(args.baseline) as f: baseline = json.load(f)

    current_f1 = current.get('macroF1', 0)
    baseline_f1 = baseline.get('macroF1', 0)

    # 2. F1 阈值校验
    if current_f1 < args.min_macro_f1:
        sys.exit(f"❌ 门禁失败: Macro-F1 ({current_f1}) 低于绝对阈值 {args.min_macro_f1}")
    
    # 3. 回归对比校验
    if current_f1 < baseline_f1 - args.max_drop:
        sys.exit(f"❌ 门禁失败: Macro-F1 ({current_f1}) 较基线 ({baseline_f1}) 下降超过 {args.max_drop}")

    print(f"✅ 门禁通过: Macro-F1 = {current_f1}")

if __name__ == '__main__':
    main()
