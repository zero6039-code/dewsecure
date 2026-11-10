// ==========================================
// 🛡️ AD-6: 元素隐藏（Cosmetic）动态规则模块
// 按站点注入 CSS，规避金融站点误伤，防范 CSS 注入
// ==========================================

const FINANCIAL_KEYWORDS = ['bank', 'paypal', 'chase', 'visa', 'mastercard', 'stripe', 'alipay', 'wechatpay', 'binance', 'coinbase', 'schwab', 'fidelity', 'wellsfargo', 'citi'];
const BLOCKED_CSS_PATTERNS = [
    /@import/i,
    /url\s*\(/i,
    /expression\s*\(/i,
    /javascript:/i,
    /<script/i,
    /behavior\s*:/i
];

export function isFinancialSite(hostname) {
    if (!hostname) return false;
    const h = hostname.toLowerCase();
    return FINANCIAL_KEYWORDS.some(k => h.includes(k));
}

export function sanitizeCSS(css) {
    if (typeof css !== 'string') return null;
    for (const pattern of BLOCKED_CSS_PATTERNS) {
        if (pattern.test(css)) {
            console.warn('⚠️ [Cosmetic] 拦截危险的 CSS 规则:', pattern);
            return null;
        }
    }
    return css;
}

export async function syncCosmeticRules(bundle, brokenSites = []) {
    if (!bundle || !Array.isArray(bundle.cosmetics)) return;

    const scripts = [];
    for (let i = 0; i < bundle.cosmetics.length; i++) {
        const rule = bundle.cosmetics[i];
        if (!Array.isArray(rule.match) || typeof rule.css !== 'string') continue;
        
        // AD-8 过滤误伤站点
        if (rule.match.some(m => brokenSites.some(b => m.includes(b)))) continue;

        // 过滤金融站点
        const isSafeMatch = rule.match.every(m => !isFinancialSite(m));
        if (!isSafeMatch) {
            console.log('ℹ️ [Cosmetic] 跳过金融站点规则:', rule.match);
            continue;
        }

        const safeCss = sanitizeCSS(rule.css);
        if (!safeCss) continue;

        scripts.push({
            id: `dew-cs-${i}`,
            matches: rule.match,
            css: [safeCss],
            runAt: 'document_start',
            persistAcrossSessions: true
        });
    }

    try {
        const old = await chrome.scripting.getRegisteredContentScripts();
        const oldIds = old.filter(o => o.id.startsWith('dew-cs-')).map(o => o.id);
        if (oldIds.length) await chrome.scripting.unregisterContentScripts({ ids: oldIds });
        if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
        console.log(`🛡️ [AD-6] 已注册 ${scripts.length} 条 Cosmetic 规则`);
    } catch (e) {
        console.warn('⚠️ [AD-6] Cosmetic 规则注册失败:', e);
    }
}
