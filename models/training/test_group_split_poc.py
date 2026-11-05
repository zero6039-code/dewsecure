import random

print("--- 深度 POC：同根域名数据泄漏测试 ---\n")

# 1. 构造数据集：包含 50 个恶意子域，50 个正常子域
domains = [f"sub{i}.evil-tracker.com" for i in range(50)] + \
          [f"api{i}.good-site.com" for i in range(50)]
labels = [1] * 50 + [0] * 50
data = list(zip(domains, labels))

def get_root(domain):
    parts = domain.split('.')
    return ".".join(parts[-2:])

# ==========================================
# 传统随机划分 (Random Shuffle)
# ==========================================
print("❌ [传统随机划分 (Random Shuffle)]")
random.seed(42)
random_data = data.copy()
random.shuffle(random_data)

split_idx = int(len(random_data) * 0.8)
train_random = random_data[:split_idx]
test_random = random_data[split_idx:]

train_root_r = set(get_root(d) for d, l in train_random)
test_root_r = set(get_root(d) for d, l in test_random)
overlap_r = train_root_r.intersection(test_root_r)

print(f"   训练集主域名: {train_root_r}")
print(f"   测试集主域名: {test_root_r}")
print(f"   🚨 泄漏的主域名: {overlap_r} (同一个主域的子域被分到了两边，导致模型背答案)\n")

# ==========================================
# 深度修复：按 eTLD+1 分组划分 (GroupShuffleSplit)
# ==========================================
print("✅ [按主域名分组划分 (GroupShuffleSplit)]")
# 按主域名分组
grouped = {}
for d, l in data:
    root = get_root(d)
    if root not in grouped:
        grouped[root] = []
    grouped[root].append((d, l))

# 打乱主域名
roots = list(grouped.keys())
random.shuffle(roots)

# 取前 80% 的主域名作为训练集
split_root_idx = int(len(roots) * 0.8)
train_roots = set(roots[:split_root_idx])
test_roots = set(roots[split_root_idx:])

train_group = [item for r in train_roots for item in grouped[r]]
test_group = [item for r in test_roots for item in grouped[r]]

train_root_g = set(get_root(d) for d, l in train_group)
test_root_g = set(get_root(d) for d, l in test_group)
overlap_g = train_root_g.intersection(test_root_g)

print(f"   训练集主域名: {train_root_g}")
print(f"   测试集主域名: {test_root_g}")
print(f"   🎉 泄漏的主域名: {overlap_g if overlap_g else '无 (100% 隔离)'}")
print(f"   结论: 模型在测试集上面对的完全是不认识的新主域，彻底杜绝了投机取巧！")
