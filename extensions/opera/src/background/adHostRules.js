// ==========================================
// 🛡️ AD-1: 广告/恶意域名清单合并模块
// 将海量域名合并在单条规则中，极大节省配额
// ==========================================

export const HARD_SAFE = [
    'github.com', 'githubusercontent.com', 'github.io', 'gitlab.com', 'npmjs.com',
    'cloudflare.com', 'microsoft.com', 'apple.com', 'dewsecure.com', 'google.com',
    'youtube.com', 'facebook.com', 'dropbox.com', 'dropboxusercontent.com'
];

function isHardSafe(domain) {
    return HARD_SAFE.some(d => domain === d || domain.endsWith('.' + d));
}

/**
 * 构建合并后的 DNR 规则
 * @param {Array} rawRulesData 原始规则数组（含域名）
 * @param {number} baseId DNR 规则 ID 的起始点
 * @param {number} maxRules 最大允许生成的规则数
 * @returns {Array} 合并后的 DNR 规则数组
 */
export function buildMergedRules(rawRulesData, baseId, maxRules = 4900, brokenSites = []) {
    const domainsSet = new Set();
    
    // 1. 提取并清洗所有有效域名
    for (const rule of rawRulesData) {
        let d = rule.condition?.requestDomains?.[0] || rule.domain;
        if (typeof d !== 'string') continue;
        d = d.trim().toLowerCase();
        
        // 基础正则校验，防止恶意注入
        if (/^[a-z0-9.-]+$/.test(d) && !isHardSafe(d)) {
            // 🛡️ AD-8: 过滤掉用户标记为误伤的域名
            if (!brokenSites.some(b => d === b || d.endsWith('.' + b))) {
                domainsSet.add(d);
            }
        }
    }

    const cleanDomains = [...domainsSet];
    const CHUNK_SIZE = 500; // 每 500 个域名合并为 1 条 DNR 规则
    const newRules = [];

    // 2. 分批合并
    for (let i = 0; i < cleanDomains.length; i += CHUNK_SIZE) {
        if (newRules.length >= maxRules) {
            console.warn(`⚠️ [AdHostRules] 合并规则已达上限 (${maxRules} 条)，后续域名被截断。`);
            break;
        }

        const chunk = cleanDomains.slice(i, i + CHUNK_SIZE);
        
        newRules.push({
            id: baseId + newRules.length,
            priority: 2000000,
            // 注意：这里采用 block 拦截，因为合并后无法动态生成带具体域名的 warning.html URL
            // 浏览器原生的 ERR_BLOCKED_BY_CLIENT 也是标准的安全警告
            action: { type: 'block' },
            condition: {
                requestDomains: chunk,
                resourceTypes: ["main_frame", "sub_frame", "script", "xmlhttprequest", "image", "ping", "websocket", "other"]
            }
        });
    }

    return newRules;
}
