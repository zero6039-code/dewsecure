import pandas as pd

print("--- E1 修复 POC 验证：数据泄漏污染测试 ---\n")

# 1. 构造一个高度不平衡的真实数据集
# 800 个 Normal, 50 个 Ad, 50 个 Tracker (Tracker 仅占 5.5%)
domains = [f'normal{i}.com' for i in range(800)] + \
          [f'ad{i}.com' for i in range(50)] + \
          [f'tracker{i}.com' for i in range(50)]
labels = [0] * 800 + [1] * 50 + [2] * 50
df_original = pd.DataFrame({'domain': domains, 'label': labels})

print(f"原始数据集真实分布: 总量 {len(df_original)} | Tracker 数量: {len(df_original[df_original['label']==2])}")
print("-" * 50)

# ==========================================
# 模拟修复前 (E1 漏洞)：先过采样，后划分
# ==========================================
df_bad = df_original.copy()
trackers_bad = df_bad[df_bad['label'] == 2]
# 复制 4 份
for _ in range(4):
    df_bad = pd.concat([df_bad, trackers_bad], ignore_index=True)

df_bad = df_bad.sample(frac=1, random_state=42).reset_index(drop=True)
split_bad = int(len(df_bad) * 0.8)
test_bad = df_bad[split_bad:]

tracker_in_test_bad = len(test_bad[test_bad['label'] == 2])
ratio_bad = tracker_in_test_bad / len(test_bad) * 100

print("❌ [修复前：先过采样，后划分]")
print(f"   过采样后总数据量: {len(df_bad)}")
print(f"   测试集总量: {len(test_bad)}")
print(f"   测试集中 Tracker 数量: {tracker_in_test_bad} (占测试集 {ratio_bad:.2f}%)")
print("   🚨 结论: 测试集中混入了大量人工复制的 Tracker，导致评估指标严重虚高！\n")

# ==========================================
# 模拟修复后 (E1 修复)：先划分，后过采样
# ==========================================
df_good = df_original.copy()
df_good = df_good.sample(frac=1, random_state=42).reset_index(drop=True)
split_good = int(len(df_good) * 0.8)
train_good = df_good[:split_good].copy()
test_good = df_good[split_good:].copy()

# 只对训练集过采样
trackers_good = train_good[train_good['label'] == 2]
for _ in range(4):
    train_good = pd.concat([train_good, trackers_good], ignore_index=True)

train_good = train_good.sample(frac=1, random_state=42).reset_index(drop=True)

tracker_in_test_good = len(test_good[test_good['label'] == 2])
ratio_good = tracker_in_test_good / len(test_good) * 100

print("✅ [修复后：先划分，后过采样]")
print(f"   过采样后总训练集量: {len(train_good)} (仅训练集被放大)")
print(f"   测试集总量: {len(test_good)} (保持原始大小)")
print(f"   测试集中 Tracker 数量: {tracker_in_test_good} (占测试集 {ratio_good:.2f}%)")
print("   🎉 结论: 测试集完美保持了真实世界的原始分布，未受任何人工复制污染！")
