export const STATS_KEY = 'dewsecure_stats';
export const LOG_KEY = 'dewsecure_logs';
export const SETTINGS_KEY = 'dewsecure_settings';

export const DEFAULT_SETTINGS = {
    dnrEnabled: true, antiHijackEnabled: true, phishingEnabled: true,
    aiFourEnabled: true, aiEnabled: true, antiBypassEnabled: true,
    blockTrackers: true, hideCookieNotices: true, hideAdPlaceholders: true,
    blockSocialTrackers: true, whitelist: [], tempWhitelist: [], dailyLimit: 50,
    dailyUsed: 0, lastResetDate: new Date().toDateString(), tier: 'free',
};

export async function getSettings() {
    let { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
    if (!settings || typeof settings !== 'object') settings = {};
    settings = { ...DEFAULT_SETTINGS, ...settings };
    if (!Array.isArray(settings.whitelist)) settings.whitelist = [];
    if (!Array.isArray(settings.tempWhitelist)) settings.tempWhitelist = [];
    return settings;
}

export async function initSettings() {
    const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
    if (!settings) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    } else {
        const merged = { ...DEFAULT_SETTINGS, ...settings };
        if (!Array.isArray(merged.tempWhitelist)) merged.tempWhitelist = [];
        if (!Array.isArray(merged.whitelist)) merged.whitelist = [];
        await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
    }
}
