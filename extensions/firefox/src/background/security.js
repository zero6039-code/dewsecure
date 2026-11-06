import { getSettings } from './settings.js';

const SAFE_OFFICIAL_DOMAINS = [
    'trip.com', 'shopee.com.my', 'tiktok.com', 'kkday.com', 'klook.com',
    'lazada.com.my', 'opera.com', 'traveloka.com', 'shein.com'
];

export const TARGET_DOMAINS = [
    'trip.com', 'shopee.com.my', 'kkday.com', 'klook.com', 
    'lazada.com.my', 'traveloka.com', 'omguk.com', 
    'tiktok.com', 'ticket.com' // 👈 补充新的恶意重定向常客
];

// 需要移除的广告追踪参数名
export const TRACKING_KEYS = [
    'a_aid', 'a_bid', 'gsid', 'gsc', 'data1', 'data2',
    'mmp_pid', 'Allianceid', 'clickref', 'partner_id',
    'banid', 'campid', 'affiliate_id', 'sub_id',
    'uls_trackid', 'chain_key', 'trip_sub1', 'ud1',
    'laz_trackid', 'mkttid', 'exlaz', 'tag_aff_id', 'tag_aff_type'
];

function isSafeNavigation(url) {
    if (!url) return true;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:') || url.startsWith('edge://')) return true;
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '');
        const isOfficial = SAFE_OFFICIAL_DOMAINS.some(d => host === d || host.endsWith('.' + d));
        const hasAdParam = TRACKING_KEYS.some(k => u.searchParams.has(k));
        if (isOfficial && !hasAdParam) return true;
    } catch(_) {}
    return false;
}

async function checkIsWhitelisted(host) {
    if (!host) return false;
    const settings = await getSettings();
    return (settings.whitelist || []).some(d => host === d || host.endsWith('.' + d)) ||
           (settings.tempWhitelist || []).some(d => host === d || host.endsWith('.' + d));
}

async function getCleanedUrl(url) {
    if (!url || isSafeNavigation(url)) return null;
    if (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) return null;
    
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch(e) { return null; }
    
    const isTargetDomain = TARGET_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
    if (!isTargetDomain) return null;
    if (await checkIsWhitelisted(hostname)) return null;

    try {
        const u = new URL(url);
        let modified = false;
        const paramsToDelete = [];
        for (const [key, value] of u.searchParams.entries()) {
            const lowerKey = key.toLowerCase();
            if (TRACKING_KEYS.includes(key)) {
                paramsToDelete.push(key);
            } else if (lowerKey === 'utm_source' && ['an_', 'involveasia', 'open_api', 'adcash'].some(v => value.toLowerCase().includes(v))) {
                paramsToDelete.push(key);
            } else if (lowerKey === 'aid' && value.startsWith('api')) {
                paramsToDelete.push(key);
            }
        }

        if (paramsToDelete.length > 0) {
            for (const key of paramsToDelete) u.searchParams.delete(key);
            return u.toString();
        }
        return null;
    } catch(e) { return null; }
}

export function initSecurityListeners() {
    // 🚀 核心恢复：新弹窗（onCreatedNavigationTarget）只要命中去参逻辑，直接【秒杀关闭】！
    if (chrome.webNavigation && chrome.webNavigation.onCreatedNavigationTarget) {
        chrome.webNavigation.onCreatedNavigationTarget.addListener(async (info) => {
            const cleanedUrl = await getCleanedUrl(info.url);
            if (cleanedUrl) {
                // 用户希望弹窗秒杀，直接 remove
                chrome.tabs.remove(info.tabId, () => { if (chrome.runtime.lastError) {} });
            }
        });
    }

    // 🛡️ N-15 优化：DNR 已在网络层完成去参，移除冗余的 tabs.update 刷新
    // 保留 onCreatedNavigationTarget 的 tabs.remove 逻辑，应对恶意弹窗

}
