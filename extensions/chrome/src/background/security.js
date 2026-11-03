import { getSettings } from './settings.js';

const SAFE_OFFICIAL_DOMAINS = [
    'trip.com', 'shopee.com.my', 'tiktok.com', 'kkday.com', 'klook.com',
    'lazada.com.my', 'opera.com', 'traveloka.com', 'shein.com'
];

const TARGET_DOMAINS = [
    'trip.com', 'shopee.com.my', 'kkday.com', 'klook.com', 
    'lazada.com.my', 'traveloka.com', 'omguk.com'
];

// 需要移除的广告追踪参数名
const TRACKING_KEYS = [
    'a_aid', 'a_bid', 'gsid', 'gsc', 'data1', 'data2',
    'mmp_pid', 'Allianceid', 'clickref', 'partner_id',
    'banid', 'campid', 'affiliate_id', 'sub_id',
    'uls_trackid', 'chain_key', 'trip_sub1', 'ud1',
    'laz_trackid', 'mkttid', 'exlaz'
];

function isSafeNavigation(url) {
    if (!url) return true;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:') || url.startsWith('edge://')) return true;
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '');
        const isOfficial = SAFE_OFFICIAL_DOMAINS.some(d => host === d || host.endsWith('.' + d));
        // 安全检查：如果已经不带广告参数了，直接放行
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

// 🛡️ M-2 修复：获取去参后的干净 URL
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
        
        // 精准遍历 searchParams，移除黑名单键名
        const paramsToDelete = [];
        for (const [key, value] of u.searchParams.entries()) {
            const lowerKey = key.toLowerCase();
            // 匹配常见追踪参数
            if (TRACKING_KEYS.includes(key)) {
                paramsToDelete.push(key);
            } 
            // 匹配特定值的 utm_source
            else if (lowerKey === 'utm_source' && ['an_', 'involveasia', 'open_api', 'adcash'].some(v => value.toLowerCase().includes(v))) {
                paramsToDelete.push(key);
            }
            // 匹配 aid=api|
            else if (lowerKey === 'aid' && value.startsWith('api')) {
                paramsToDelete.push(key);
            }
        }

        if (paramsToDelete.length > 0) {
            for (const key of paramsToDelete) {
                u.searchParams.delete(key);
            }
            return u.toString();
        }
        return null;
    } catch(e) { return null; }
}

export function initSecurityListeners() {
    // 🚀 M-2 修复：新弹窗不关闭，而是原地去参重定向
    if (chrome.webNavigation && chrome.webNavigation.onCreatedNavigationTarget) {
        chrome.webNavigation.onCreatedNavigationTarget.addListener(async (info) => {
            const cleanedUrl = await getCleanedUrl(info.url);
            if (cleanedUrl) {
                chrome.tabs.update(info.tabId, { url: cleanedUrl });
            }
        });
    }

    // 🚀 M-2 修复：主页面跳转不关闭，而是原地去参重定向
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        const url = changeInfo.url;
        // 只在 URL 发生变化时触发，防止死循环
        if (url) {
            const cleanedUrl = await getCleanedUrl(url);
            if (cleanedUrl) {
                chrome.tabs.update(tabId, { url: cleanedUrl });
            }
        }
    });

    // 🚀 M-2 修复：新建标签页时，如果直接包含参数也去参
    chrome.tabs.onCreated.addListener(async (tab) => {
        const url = tab.pendingUrl || tab.url;
        if (url) {
            const cleanedUrl = await getCleanedUrl(url);
            if (cleanedUrl) {
                chrome.tabs.update(tab.id, { url: cleanedUrl });
            }
        }
    });
}
