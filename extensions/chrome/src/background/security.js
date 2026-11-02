import { getSettings } from './settings.js';

const SAFE_OFFICIAL_DOMAINS = [
    'trip.com', 'shopee.com.my', 'tiktok.com', 'kkday.com', 'klook.com',
    'lazada.com.my', 'opera.com', 'traveloka.com', 'shein.com'
];
const AD_KEYS = [
    'a_aid=', 'a_bid=', 'gsid=', 'gsc=', 'data1=', 'data2=',
    'mmp_pid=', 'Allianceid=', 'utm_source=an_', 'clickref=',
    'partner_id=', 'aid=api|', 'banid=', 'campid=',
    'affiliate_id=', 'sub_id=scs', 'utm_source=InvolveAsia',
    'utm_source=open_api', 'uls_trackid=', 'chain_key=',
    'utm_source=adcash', 'trip_sub1=', 'ud1=', 'laz_trackid=', 'mkttid=', 'exlaz=',
];

function isSafeNavigation(url) {
    if (!url) return true;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:') || url.startsWith('edge://')) return true;
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '');
        const isOfficial = SAFE_OFFICIAL_DOMAINS.some(d => host === d || host.endsWith('.' + d));
        const hasAdParam = /[?&](mmp_pid|Allianceid|uls_trackid|affiliate_id|chain_key|trip_sub1|utm_source=an_|utm_source=InvolveAsia|utm_source=adcash|aid=api|ud1|laz_trackid|mkttid|exlaz)=/i.test(u.search);
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

export function initSecurityListeners() {
    const shouldBlock = async (url) => {
        if (!url || isSafeNavigation(url)) return false;
        // 🛡️ 修复：绝不对扩展自身的页面进行重定向，否则会导致 ERR_BLOCKED_BY_CLIENT 死循环
        if (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) return false;
        
        let hostname = '';
        try { hostname = new URL(url).hostname; } catch(e) { return false; }
        
        const TARGET_DOMAINS = [
            'trip.com', 'shopee.com.my', 'kkday.com', 'klook.com', 
            'lazada.com.my', 'traveloka.com', 'omguk.com'
        ];
        const isTargetDomain = TARGET_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
                                 
        if (!isTargetDomain) return false;
        if (await checkIsWhitelisted(hostname)) return false;

        try {
            const u = new URL(url);
            const hasAdParam = AD_KEYS.some(k => u.search.includes(k));
            return hasAdParam;
        } catch(e) { return false; }
    };

    // 🚀 1.2.6 原版体验：新弹窗秒关，绝不产生任何标签页
    if (chrome.webNavigation && chrome.webNavigation.onCreatedNavigationTarget) chrome.webNavigation.onCreatedNavigationTarget.addListener(async (info) => {
        if (await shouldBlock(info.url)) {
            chrome.tabs.remove(info.tabId, () => { if (chrome.runtime.lastError) {} });
        }
    });

    // 🚀 1.2.6 原版体验：主页面跳转秒关，绝不用警告页拦截（防止 my.trip.com 误杀）
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        const url = changeInfo.url || tab.url || '';
        if (await shouldBlock(url)) {
            chrome.tabs.remove(tabId, () => { if (chrome.runtime.lastError) {} });
        }
    });

    chrome.tabs.onCreated.addListener(async (tab) => {
        const url = tab.pendingUrl || tab.url || '';
        if (await shouldBlock(url)) {
            chrome.tabs.remove(tab.id, () => { if (chrome.runtime.lastError) {} });
        }
    });
}
