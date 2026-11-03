(function() {
    // F-03: 主世界无法调用 chrome.runtime，完全依赖 content.js 通过 postMessage 传递 DEWSECURE_PAUSE 信号

// ===== 白名单热更新接管 =====
let isPaused = false;
// 备份原生方法
const nativeWindowOpen = window.open;
const nativeLocationAssign = window.location.assign;

let dwSettings = { antiHijackEnabled: true, antiBypassEnabled: true, blockSocialTrackers: true };
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'DEWSECURE_PAUSE') {
        isPaused = true;
        // M-15 修复：用 defineProperty 强制还原 window.open
        try {
            Object.defineProperty(window, 'open', { value: nativeWindowOpen, writable: true, configurable: true });
        } catch (err) {
            try { window.open = nativeWindowOpen; } catch (_) {}
        }
        console.log('[DewSecure Inject] 主世界已挂起，恢复原生 API');
    }
    if (e.data && e.data.type === 'DEWSECURE_SETTINGS') {
        dwSettings = e.data.settings || {};
    }
});

(function() {
    'use strict';
    if (window.location.hostname === 'dewsecure.com' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return;
    }

    if (window.__dewsecureInjected) return;
    window.__dewsecureInjected = true;

    function isPaused() {
        if (!document.documentElement) return false;
        return document.documentElement.getAttribute('data-dewsecure-paused') === 'true';
    }

    // H-1 修复：只拦第三方广告主机或已知联盟参数
    const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|propellerads\.com|adsterra\.com|1xbet\.com|1xlite\.com|omguk\.com)$/i;
    const AFFILIATE_PARAMS = ['mmp_pid', 'Allianceid', 'uls_trackid', 'a_aid', 'a_bid', 'affiliate_id', 'from_affiliate', 'tag_aff_id', 'tag_aff_type'];

    const isAdUrl = (raw) => {
        if (dwSettings.antiHijackEnabled === false) return false;
        if (raw == null || raw === '') return false;
        try {
            const u = new URL(String(raw), location.href);
            if (u.origin === location.origin) return false;
            return AD_HOSTS.test(u.hostname) ||
                   AFFILIATE_PARAMS.some((p) => u.searchParams.has(p));
        } catch (_) {
            return false;
        }
    };

    const _locationAssign = window.location.assign;
    const _locationReplace = window.location.replace;
    const _anchorClick = HTMLAnchorElement.prototype.click;
    const _formSubmit = HTMLFormElement.prototype.submit;

    // 0. 拦截系统通知请求
    const NOTIFICATION_ALLOW_HOSTS = ['mail.google.com', 'calendar.google.com', 'outlook.live.com', 'outlook.office.com', 'web.whatsapp.com', 'web.telegram.org'];
    try {
        if (window.Notification) {
            const _requestPermission = window.Notification.requestPermission;
            window.Notification.requestPermission = function(callback) {
                const h = location.hostname;
                const isAllowedHost = NOTIFICATION_ALLOW_HOSTS.some(d => h === d || h.endsWith('.' + d));
                if (!isPaused() && dwSettings.antiHijackEnabled !== false && !isAllowedHost) {
                    console.log('[DewSecure] 已拦截系统通知请求');
                    if (callback) callback('denied');
                    return Promise.resolve('denied');
                }
                return _requestPermission.apply(this, arguments);
            };
        }
    } catch(e) {}

    // 1. window.open (修复双倍弹窗与不可配置问题)
    try {
        const _windowOpen = window.open;
        const nativeOpenStr = _windowOpen.toString();
        const isSkidrow = window.location.hostname.includes('skidrowreloaded.com');

        const hookedOpen = function(url, target, features) {
            // 🛡️ 绝杀：对于 Skidrow，无视任何参数，直接掐死所有 window.open
            if (!isPaused() && isSkidrow) {
                console.warn('[DewSecure] 彻底封锁 Skidrow 弹窗:', url);
                return null;
            }
            // 普通站点：命中广告特征才拦截
            if (!isPaused() && isAdUrl(url)) {
                console.warn('[DewSecure] 拦截恶意/劫持弹窗:', url);
                return null;
            }
            return _windowOpen.apply(this, arguments);
        };

        hookedOpen.toString = function() { return nativeOpenStr; };

        Object.defineProperty(window, 'open', {
            get: function() { return hookedOpen; },
            set: function() { /* 劫持赋值，保持静默 */ },
            configurable: true,
            enumerable: true
        });
    } catch (e) {
        try {
            const _fallbackOpen = window.open;
            window.open = function(url, target, features) {
                if (!isPaused() && isAdUrl(url) && window.navigator?.userActivation?.isActive === false) {
                    return null;
                }
                return _fallbackOpen.apply(this, arguments);
            };
        } catch(err) {}
    }

    // 3. A 标签点击
    try {
        HTMLAnchorElement.prototype.click = function() {
            if (!isPaused()) {
                if (isAdUrl(this.href)) return;
                // 拦截脚本模拟的 _blank 跨站弹窗
                if (this.target === '_blank' && this.href && !this.href.startsWith(location.origin)) {
                    if (window.event && window.event.isTrusted) {
                        // 真实点击放行，交由 security.js 后台秒杀
                    } else {
                        console.warn('[DewSecure] 拦截脚本模拟的 _blank 弹窗:', this.href);
                        return;
                    }
                }
            }
            _anchorClick.apply(this, arguments);
        };
    } catch (e) {}

    // 4. Form 提交
    try {
        HTMLFormElement.prototype.submit = function() {
            if (!isPaused() && isAdUrl(this.action)) return;
            _formSubmit.apply(this, arguments);
        };
    } catch (e) {}

    // 5. 反反拦截欺骗
    if (!isPaused() && dwSettings.antiBypassEnabled !== false) {
        try {
            Object.defineProperty(window, 'adblock', { get: () => false, configurable: true });
            Object.defineProperty(window, 'canRunAds', { get: () => true, configurable: true });
        } catch(e) {}
    }

    // 6. Skidrow 弹窗劫持防护 (旧变量防护)
    if (window.location.hostname.includes('skidrowreloaded.com') && !isPaused()) {
        try {
            Object.defineProperty(window, 'clickIE4', { get: () => undefined, set: () => {}, configurable: false });
        } catch(e) {}
    }

    // 7. 点击拦截捕获
    const interceptClick = (e) => {
        if (isPaused()) return;
        let target = e.target;
        while (target && target.tagName !== 'A' && target.tagName !== 'FORM') target = target.parentElement;
        
        if (target) {
            if (target.tagName === 'A' && target.href && isAdUrl(target.href)) {
                e.preventDefault(); e.stopImmediatePropagation();
                return;
            }
            if (target.tagName === 'FORM' && target.action && isAdUrl(target.action)) {
                e.preventDefault(); e.stopImmediatePropagation();
                return;
            }
            // 🛡️ 终极绝杀：对于 Skidrow，任何试图新开窗口的点击，全灭！
            if (window.location.hostname.includes('skidrowreloaded.com')) {
                if (target.tagName === 'A' && target.href && !target.href.startsWith(location.origin)) {
                    if (target.target === '_blank' || e.ctrlKey || e.metaKey) {
                        console.warn('[DewSecure] 彻底封杀 Skidrow 恶意跳转点击:', target.href);
                        e.preventDefault(); e.stopImmediatePropagation();
                    }
                }
            }
        }
    };
    document.addEventListener('mousedown', interceptClick, true);
    document.addEventListener('click', interceptClick, true);

    // 8. DOM 节点清理
    const checkAndKillNode = (el) => {
        if (el.dataset.dwKilled) return;
        if (el.tagName === 'A' && el.href && isAdUrl(el.href)) {
            el.removeAttribute('href'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
        } else if (el.tagName === 'FORM' && el.action && isAdUrl(el.action)) {
            el.removeAttribute('action'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
        }
    };

    const killMaliciousNodes = (root) => {
        if (isPaused() || !root) return;
        if (root.nodeType === Node.ELEMENT_NODE) checkAndKillNode(root);
        const links = root.querySelectorAll ? root.querySelectorAll('a, form') : [];
        links.forEach(checkAndKillNode);
    };

    const observer = new MutationObserver((mutations) => {
        if (isPaused()) return;
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.className && typeof node.className === 'string' && /(^ad-slot|^ad-banner|^ad-wrapper|^ad-container|^adsbygoogle|^sponsored-ad|^advertisement)/i.test(node.className)) {
                        node.style.setProperty('display', 'none', 'important');
                    }
                    killMaliciousNodes(node);
                }
            }
        }
    });
    
    const startObserver = () => {
        if (!document.documentElement) return;
        observer.observe(document.documentElement, { childList: true, subtree: true });
        killMaliciousNodes(document.documentElement);
    };

    if (document.documentElement) {
        startObserver();
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        window.addEventListener('load', startObserver);
    }
})();
})();
