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
        let hostname = '';
        try { hostname = new URL(url).hostname; } catch(e) { return false; }
        
        // 🔒 F-02 修复：只对特定的域名，且带有明确的广告参数才进行拦截
        // 绝不再使用宽泛的子串匹配
        // 🔒 M5 修复：精确匹配点边界，防止 strip.com 误伤 trip.com
        const TARGET_DOMAINS = [
            'trip.com', 'shopee.com.my', 'kkday.com', 'klook.com', 
            'lazada.com.my', 'traveloka.com', 'omguk.com'
        ];
        const isTargetDomain = TARGET_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
                               
        if (!isTargetDomain) return false;
        if (await checkIsWhitelisted(hostname)) return false;

        // 检查 URL search 参数中是否包含高危推广参数
        try {
            const u = new URL(url);
            const hasAdParam = AD_KEYS.some(k => u.search.includes(k));
            return hasAdParam;
        } catch(e) { return false; }
    };

    if (chrome.webNavigation && chrome.webNavigation.onCreatedNavigationTarget) chrome.webNavigation.onCreatedNavigationTarget.addListener(async (info) => {
        if (await shouldBlock(info.url)) {
            const warnUrl = chrome.runtime.getURL(`warning.html?type=affiliate&url=${encodeURIComponent(info.url)}`);
            chrome.tabs.update(info.tabId, { url: warnUrl });
        }
    });

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        const url = changeInfo.url || tab.url || '';
        if (await shouldBlock(url)) {
            const warnUrl = chrome.runtime.getURL(`warning.html?type=affiliate&url=${encodeURIComponent(url)}`);
            chrome.tabs.update(tabId, { url: warnUrl });
        }
    });

    chrome.tabs.onCreated.addListener(async (tab) => {
        const url = tab.pendingUrl || tab.url || '';
        if (await shouldBlock(url)) {
            const warnUrl = chrome.runtime.getURL(`warning.html?type=affiliate&url=${encodeURIComponent(url)}`);
            chrome.tabs.update(tab.id, { url: warnUrl });
        }
    });
}
