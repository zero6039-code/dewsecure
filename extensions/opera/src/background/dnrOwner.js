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

        // 🌟 核心修复：在注入动态规则前，强制将所有 requestDomains 转为小写，修复 Firefox 的 Invalid domain 报错
        for (const rule of rules) {
            if (rule.condition && rule.condition.requestDomains) {
                rule.condition.requestDomains = rule.condition.requestDomains.map(d => String(d).toLowerCase());
            }
        }

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


// ==========================================
// 🛡️ C2 修复：统一的规则 ID 分配器（串行执行，防竞态，防死锁）
// ==========================================
const RULE_ID_BASE = 10000;
const ID_MAP_KEY = 'ruleIdMap';
const NEXT_ID_KEY = 'nextRuleId';

// 🔒 核心锁方法，供外部调用
export function withLock(fn) {
    const task = queue.then(fn);
    queue = task.catch(e => console.warn('[Lock] 任务执行异常:', e));
    return task;
}

// ⚠️ 无锁版本，只能在 withLock 内部调用！
export async function getOrCreateRuleIdUnsafe(domain) {
    const data = await chrome.storage.local.get([ID_MAP_KEY, NEXT_ID_KEY]);
    let ruleIdMap = data[ID_MAP_KEY] || {};
    let nextRuleId = data[NEXT_ID_KEY] || RULE_ID_BASE;
    
    if (ruleIdMap[domain]) return ruleIdMap[domain];

    const newId = nextRuleId;
    ruleIdMap[domain] = newId;
    await chrome.storage.local.set({ 
        [ID_MAP_KEY]: ruleIdMap, 
        [NEXT_ID_KEY]: newId + 1 
    });
    return newId;
}

// 🔒 带锁版本，供外部直接调用
export async function getOrCreateRuleId(domain) {
    return withLock(() => getOrCreateRuleIdUnsafe(domain));
}

// ⚠️ 无锁版本，供锁内调用
export async function removeRuleIdMappingUnsafe(domain) {
    const data = await chrome.storage.local.get(ID_MAP_KEY);
    let ruleIdMap = data[ID_MAP_KEY] || {};
    if (ruleIdMap[domain]) {
        delete ruleIdMap[domain];
        await chrome.storage.local.set({ [ID_MAP_KEY]: ruleIdMap });
    }
}

// 🔒 带锁版本
export async function removeRuleIdMapping(domain) {
    return withLock(() => removeRuleIdMappingUnsafe(domain));
}
