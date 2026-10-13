/**
 * DewSecure Firefox Background Script
 *
 * Firefox 使用 webRequest.filterResponseData 提供比 Chrome DNR 更灵活的拦截能力。
 */

const AD_DOMAINS = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adservice.google.com',
    'advertising.com',
    'criteo.com',
    'outbrain.com',
    'taboola.com',
    'pubmatic.com',
    'rubiconproject.com',
    'openx.net',
];

const TRACKER_DOMAINS = [
    'google-analytics.com',
    'googletagmanager.com',
    'connect.facebook.net',
    'hotjar.com',
    'mixpanel.com',
    'segment.com',
    'amplitude.com',
    'fullstory.com',
];

let settings = {
    aiEnabled: true,
    antiBypassEnabled: true,
    blockTrackers: true,
    whitelist: [],
    subscription: 'free',
    dailyUsed: 0,
    dailyLimit: 100,
    lastResetDate: new Date().toDateString(),
};

// ============ 初始化 ============

browser.storage.local.get('settings').then((data) => {
    if (data.settings) {
        settings = { ...settings, ...data.settings };
    }
});

browser.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
        settings = changes.settings.newValue;
    }
});

// ============ 请求拦截 ============

browser.webRequest.onBeforeRequest.addListener(
    (details) => {
        // 检查白名单
        try {
            const host = new URL(details.url).hostname;
            if (settings.whitelist.some((d) => host.endsWith(d))) {
                return {};
            }
        } catch (e) {
            return {};
        }

        // 检查每日限额
        if (settings.subscription === 'free' && settings.dailyUsed >= settings.dailyLimit) {
            return {};
        }

        const url = details.url.toLowerCase();

        // 检查广告域名
        if (AD_DOMAINS.some((d) => url.includes(d))) {
            if (settings.subscription === 'free') {
                settings.dailyUsed++;
                browser.storage.local.set({ settings });
            }
            return { cancel: true };
        }

        // 检查追踪器域名
        if (settings.blockTrackers && TRACKER_DOMAINS.some((d) => url.includes(d))) {
            if (settings.subscription === 'free') {
                settings.dailyUsed++;
                browser.storage.local.set({ settings });
            }
            return { cancel: true };
        }

        return {};
    },
    { urls: ['<all_urls>'] },
    ['blocking']
);

// ============ 消息处理 ============

browser.runtime.onMessage.addListener((message, sender) => {
    switch (message.type) {
        case 'GET_STATS':
            return browser.storage.local.get(['stats', 'settings']).then((data) => ({
                stats: data.stats || { totalBlocked: 0, todayBlocked: 0 },
                settings: data.settings || settings,
            }));

        case 'GET_SETTINGS':
            return Promise.resolve(settings);

        case 'UPDATE_SETTINGS':
            settings = { ...settings, ...message.settings };
            return browser.storage.local.set({ settings }).then(() => ({ ok: true }));

        case 'ADD_WHITELIST':
            if (!settings.whitelist.includes(message.domain)) {
                settings.whitelist.push(message.domain);
                return browser.storage.local.set({ settings }).then(() => ({ ok: true }));
            }
            return Promise.resolve({ ok: true });

        case 'REMOVE_WHITELIST':
            settings.whitelist = settings.whitelist.filter((d) => d !== message.domain);
            return browser.storage.local.set({ settings }).then(() => ({ ok: true }));

        default:
            return Promise.resolve({ error: '未知消息类型' });
    }
});

console.log('DewSecure Firefox Background 已启动');
