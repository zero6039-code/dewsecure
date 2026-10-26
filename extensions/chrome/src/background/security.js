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
const TARGET_BRANDS = [
    'generali.com.my', 'steampowered.com', 'store.steampowered.com',
    'shopee.com.my', 'kkday.com', 'trip.com', 'my.trip.com', 'klook.com',
    'traveloka.com', 'tiktok.com', 'lazada.com.my', 'shein.com',
    'ragasstore.com', 'opera.com/partner', '1xlite', '1xbet', 'omguk.com',
    's.shopee.com.my', 'track.omguk.com', 'www.trip.com', 'www.kkday.com',
    'www.klook.com', 'www.opera.com/partner', 'adexchangerapid.com',
    'usrpubtrk.com', 'ntwkbc21.com', 'ntwkbc42.com',
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
    chrome.webNavigation.onCreatedNavigationTarget.addListener(async (info) => {
        const url = info.url || '';
        if (AD_KEYS.some(k => url.includes(k)) || TARGET_BRANDS.some(h => url.includes(h))) {
            try { if (await checkIsWhitelisted(new URL(url).hostname)) return; } catch(e) {}
            chrome.tabs.remove(info.tabId, () => { if (chrome.runtime.lastError) {} });
        }
    });

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        const url = changeInfo.url || tab.url || '';
        if (!url || isSafeNavigation(url)) return;
        if (AD_KEYS.some(k => url.includes(k)) || TARGET_BRANDS.some(h => url.includes(h))) {
            try { if (await checkIsWhitelisted(new URL(url).hostname)) return; } catch(e) {}
            chrome.tabs.remove(tabId, () => { if (chrome.runtime.lastError) {} });
        }
    });

    chrome.tabs.onCreated.addListener(async (tab) => {
        const url = tab.pendingUrl || tab.url || '';
        if (!url || isSafeNavigation(url)) return;
        if (AD_KEYS.some(k => url.includes(k)) || TARGET_BRANDS.some(k => url.includes(k))) {
            try { if (await checkIsWhitelisted(new URL(url).hostname)) return; } catch(e) {}
            chrome.tabs.remove(tab.id, () => { if (chrome.runtime.lastError) {} });
        }
    });
}
