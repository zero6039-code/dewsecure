/**
 * DewSecure Firefox Content Script
 * 与 Chrome 版本基本一致。
 */

(function () {
    'use strict';
    if (window.__dewsecureInjected) return;
    window.__dewsecureInjected = true;

    // 注入反反拦截
    const script = document.createElement('script');
    const seed = Date.now();
    const varName = `_0x${(seed & 0xFFFFFFFF).toString(16)}`;
    script.textContent = `
(function() {
    const ${varName} = {
        adBlock: false, adblock: false, adsBlocked: 0,
        isAdBlockActive: false, canRunAds: true, canShowAds: true
    };
    const props = ['adBlock','adblock','adsBlocked','isAdBlockActive','canRunAds','canShowAds'];
    for (const p of props) {
        try { Object.defineProperty(window, p, { get: () => ${varName}[p], configurable: true }); } catch(e) {}
    }
})();
`;
    (document.head || document.documentElement).insertBefore(script, (document.head || document.documentElement).firstChild);
    script.remove();

    // 隐藏广告元素
    const AD_SELECTORS = [
        '[class*="ad-"]', '[class*="ads-"]', '[class*="advert"]',
        '[id*="ad-"]', '[id*="ads-"]', '[id*="advert"]',
        '[class*="banner"]', '[class*="popup"]', '[class*="sponsor"]',
        'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
    ];

    function hideAds() {
        for (const sel of AD_SELECTORS) {
            try {
                document.querySelectorAll(sel).forEach((el) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 10 || rect.height < 10) return;
                    el.style.setProperty('display', 'none', 'important');
                });
            } catch (e) {}
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hideAds);
    } else {
        hideAds();
    }

    new MutationObserver(hideAds).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
})();
