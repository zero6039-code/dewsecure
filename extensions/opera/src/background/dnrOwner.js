// ==========================================
// 🔒 DNR 规则按 ID 段归属 + 串行队列
// 修复 N-1：任何模块只管理自己的 ID 段，绝不整体清空动态规则
// ==========================================

export const RANGE = {
    privacy:  [10001, 10099],       // 隐私去参 / HTTPS 升级 / Sec-GPC（N-11 将扩到 10004）
    mining:   [900000, 900999],     // 挖矿拦截
    official: [999999, 999999],     // 全局最高优先级放行
    intel:    [1000000, 1029999],   // 威胁情报（30,000 容量）
};

const inRange = (id, [lo, hi]) => id >= lo && id <= hi;

// 串行队列：消除跨模块竞态
let queue = Promise.resolve();

/**
 * 同步指定 ID 段的动态规则
 * @param {[number, number]} owned 本模块拥有的 ID 段
 * @param {Array} rules 期望最终存在的规则（全量，每条必须带 id 且落在 owned 内）
 * @returns {Promise<void>} 排队完成的 promise
 */
export function syncRules(owned, rules) {
    queue = queue.then(async () => {
        // 校验：全部 rule.id 在 owned 段内
        for (const r of rules) {
            if (!inRange(r.id, owned)) {
                console.error('[DNR] 规则 id 越界，拒绝注入:', r.id, 'owned=', owned);
                throw new Error('rule id outside owned range: ' + r.id);
            }
        }
        // 校验：id 不重复
        const ids = rules.map(r => r.id);
        if (new Set(ids).size !== ids.length) {
            console.error('[DNR] 规则 id 重复，拒绝注入:', owned);
            throw new Error('duplicate rule id');
        }
        // 只删除本段内的旧规则
        const have = (await chrome.declarativeNetRequest.getDynamicRules())
            .map(r => r.id)
            .filter(id => inRange(id, owned));
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: have,
            addRules: rules,
        });
    }).catch(e => {
        // 队列出错不阻塞后续调用
        console.warn('[DNR] sync failed, owned=', owned, e);
    });
    return queue;
}
