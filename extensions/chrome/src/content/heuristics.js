import { state } from './state.js';
import { triggerPhishingWarning } from './phishingUI.js';

const SAFE_IDP_HOSTS = ['accounts.google.com', 'login.microsoftonline.com', 'appleid.apple.com', 'okta.com', 'auth0.com'];
const SAFE_UGC_HOSTS = ['stackexchange.com', 'fandom.com', 'slashdot.org'];

export function getBaseDomain(h) {
    if (!h) return '';
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    const multiLevel = ['com.my', 'co.uk', 'com.cn', 'com.sg', 'co.id', 'com.au', 'co.jp'];
    const lastTwo = parts.slice(-2).join('.');
    return multiLevel.includes(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

function scorePage() {
    let score = 0;
    const reasons = [];
    const hostname = window.location.hostname;
    const pageBaseDomain = getBaseDomain(hostname);

    // 1. 跨站表单
    const forms = document.querySelectorAll('form');
    let hasCrossSiteCredForm = false;
    for (const form of forms) {
        const action = form.getAttribute('action');
        if (!action) continue;
        try {
            const actionUrl = new URL(action, window.location.href);
            const actionHost = actionUrl.hostname;
            const isSafeIdP = SAFE_IDP_HOSTS.some(idp => actionHost === idp || actionHost.endsWith('.' + idp));
            if (isSafeIdP) continue;

            if (actionUrl.protocol === 'data:' || actionUrl.protocol === 'blob:' || getBaseDomain(actionHost) !== pageBaseDomain) {
                score += 40;
                reasons.push({ key: 'reason_cross_site_form', arg: actionHost });
                const hasPassword = form.querySelector('input[type="password"]');
                const hasEmail = form.querySelector('input[type="email"], input[name*="email" i], input[name*="user" i], input[name*="login" i]');
                if (hasPassword || hasEmail) hasCrossSiteCredForm = true;
            }
        } catch (e) {}
    }
    if (hasCrossSiteCredForm) {
        score += 30;
        reasons.push({ key: 'reason_credential_form' });
    }

    // 2. 品牌仿冒
    const title = document.title.toLowerCase();
    const BRANDS = ['paypal', 'apple', 'microsoft', 'google', 'amazon', 'netflix', 'binance', 'coinbase', 'facebook', 'instagram'];
    for (const brand of BRANDS) {
        if (title.includes(brand) && !pageBaseDomain.includes(brand)) {
            const isSafeUGC = SAFE_UGC_HOSTS.some(ugc => hostname.includes(ugc));
            if (!isSafeUGC) {
                score += 25;
                reasons.push({ key: 'reason_brand_title', arg: brand });
                break;
            }
        }
    }

    // 3. 隐藏 iframe
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
        try {
            const src = iframe.src;
            if (src && src.startsWith('http')) {
                const iframeUrl = new URL(src);
                if (getBaseDomain(iframeUrl.hostname) !== getBaseDomain(hostname)) {
                    const style = window.getComputedStyle(iframe);
                    if (style.display === 'none' || style.visibility === 'hidden' || parseInt(style.width) <= 1) {
                        score += 15;
                        reasons.push({ key: 'reason_hidden_iframe' });
                        break;
                    }
                }
            }
        } catch(e) {}
    }

    return { score, reasons };
}

export function checkBitB() {
    if (state.phishingIgnored) return;
    const pwInputs = document.querySelectorAll('input[type="password"]');
    if (pwInputs.length === 0) return;

    for (const pw of pwInputs) {
        const box = pw.closest('[style*="fixed"], [style*="absolute"], dialog, [role=dialog]');
        if (!box) continue;

        const candidates = box.querySelectorAll('span, div, a, p, h1, h2, h3');
        for (const el of candidates) {
            if (el.contains(pw)) continue;
            const t = (el.textContent || '').trim();
            if (t.length === 0 || t.length > 120) continue;

            if (!/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) continue;

            let shownHost;
            try {
                shownHost = new URL(t.startsWith('http') ? t : 'https://' + t).hostname;
            } catch(e) { continue; }

            if (shownHost !== location.hostname && shownHost.length > 3) {
                console.warn(`🚨 [DewSecure] 检测到 BitB 伪造地址栏! 假域名: ${shownHost}，真实域名: ${location.hostname}`);
                triggerPhishingWarning(100, [{ key: 'reason_bitb', arg: shownHost }]);
                return;
            }
        }
    }
}

export function analyzePageForPhishing() {
    if (state.phishingIgnored) return;
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    if (passwordInputs.length === 0) return;

    checkBitB();

    const { score, reasons } = scorePage();
    if (score >= 60) {
        console.warn(`🚨 [DewSecure] 本地启发式检测到疑似钓鱼行为 (得分: ${score})`, reasons);
        triggerPhishingWarning(score, reasons);
    }
}
