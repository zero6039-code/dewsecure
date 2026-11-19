import { getDomain } from 'tldts';
export const SIMPLE_KEYS = new Set(['dnrEnabled', 'antiHijackEnabled', 'phishingEnabled', 'intelEnabled', 'aiFourEnabled', 'aiEnabled', 'antiBypassEnabled', 'blockTrackers', 'hideCookieNotices', 'hideAdPlaceholders', 'blockSocialTrackers', 'shareThreatCandidates']);
export function isValidWhitelistDomain(domain) {
    if (typeof domain !== 'string' || domain.length > 253 || !/^[a-z0-9.-]+$/i.test(domain)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return false;
    const parts = domain.split('.');
    if (parts.length < 2 || parts[parts.length - 1].length < 2) return false;
    const reg = getDomain(domain.toLowerCase(), { allowPrivateDomains: true });
    return reg !== null && (domain === reg || domain.endsWith('.' + reg));
}
export function isPrivilegedSender(sender) {
    if (!sender) return false;
    const extUrl = chrome.runtime.getURL('');
    return !!(sender.url && sender.url.startsWith(extUrl));
}
export function isExtensionSender(sender) {
    if (!sender) return false;
    if (sender.id === chrome.runtime.id) return true;
    if (sender.url && (sender.url.startsWith('chrome-extension://') || sender.url.startsWith('moz-extension://'))) return true;
    return false;
}
export function getETLD1(host) {
    if (!host) return host;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
    return getDomain(host, { allowPrivateDomains: true }) || host;
}
