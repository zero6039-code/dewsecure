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
        // M-15 修复：用 defineProperty 强制还原 window.open（需内层 configurable: true 配合）
        try {
            Object.defineProperty(window, 'open', { value: nativeWindowOpen, writable: true, configurable: true });
        } catch (err) {
            try { window.open = nativeWindowOpen; } catch (_) {}
        }
        console.log('[DewSecure Inject] 主世界已挂起，恢复原生 API');
    }
    // F2 修复：接收真实的设置状态
    if (e.data && e.data.type === 'DEWSECURE_SETTINGS') {
        dwSettings = e.data.settings || {};
    }
});

// 包装原本的拦截逻辑
// 移除早期冗余且会导致双倍弹窗的 window.open 包装，统一在下方处理

(function() {
    'use strict';
    // 官网与本地开发环境白名单（彻底解决 F12 卡死）
    if (window.location.hostname === 'dewsecure.com' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return;
    }

    if (window.__dewsecureInjected) return;
    window.__dewsecureInjected = true;

    // 每个 Hook 执行前检查是否暂停
    function isPaused() {
        if (!document.documentElement) return false;
        return document.documentElement.getAttribute('data-dewsecure-paused') === 'true';
    }

    // H-1 修复：只拦第三方广告主机或已知联盟参数；同源与通用追踪参数一律放行；同时支持 URL 对象
    // 移除了 utm_source= / track= / click_id= / sub_id= / affiliate= / gsc= / gsid= / aid= 等通用词
    // 移除了 tiktok.com/view 路径规则（由 DNR 层接手，inject.js 不再拦截）
    const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|propellerads\.com|adsterra\.com|1xbet\.com|1xlite\.com|omguk\.com)$/i;
    const AFFILIATE_PARAMS = ['mmp_pid', 'Allianceid', 'uls_trackid', 'a_aid', 'a_bid', 'affiliate_id', 'from_affiliate'];

    const isAdUrl = (raw) => {
        if (dwSettings.antiHijackEnabled === false) return false;   // 尊重防劫持开关
        if (raw == null || raw === '') return false;
        try {
            const u = new URL(String(raw), location.href);          // 接受 URL 对象与相对路径
            if (u.origin === location.origin) return false;         // 绝不动同站链接
            return AD_HOSTS.test(u.hostname) ||
                   AFFILIATE_PARAMS.some((p) => u.searchParams.has(p));
        } catch (_) {
            return false;
        }
    };

    const _windowOpen = window.open;
    const _locationAssign = window.location.assign;
    const _locationReplace = window.location.replace;
    const _anchorClick = HTMLAnchorElement.prototype.click;
    const _formSubmit = HTMLFormElement.prototype.submit;

    // 0. 拦截系统通知请求 (M-15 修复：增加常用邮件/通讯站点白名单)
    const NOTIFICATION_ALLOW_HOSTS = [
        'mail.google.com', 'calendar.google.com',
        'outlook.live.com', 'outlook.office.com',
        'web.whatsapp.com', 'web.telegram.org'
    ];
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
        // 伪装原生代码，防止被网页检测出 Hook
        const nativeOpenStr = _windowOpen.toString();

        const hookedOpen = function(url, target, features) {
            if (!isPaused() && isAdUrl(url)) {
                // AdGuard 策略：如果没有用户真实交互（自动弹窗），直接抛弃
                if (window.navigator && window.navigator.userActivation && !window.navigator.userActivation.isActive) {
                    console.warn('[DewSecure] 零闪烁拦截自动弹窗:', url);
                    return null;
                }
            }
            return _windowOpen.apply(this, arguments);
        };

        // 伪装 toString
        hookedOpen.toString = function() { return nativeOpenStr; };

        // 使用 defineProperty 防止被覆盖或删除
        // M-15 修复：configurable: true 允许暂停消息到达时被 defineProperty 真正还原
        Object.defineProperty(window, 'open', {
            get: function() { return hookedOpen; },
            set: function() { /* 劫持赋值，保持静默 */ },
            configurable: true,
            enumerable: true
        });
    } catch (e) {
        // 降级策略：如果 defineProperty 失败，回退到普通赋值
        // M-15 修复：保存当前引用避免 window.open.apply 自我递归
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

    // 2. location 跳转 (F-07 修复：Chrome 禁止覆盖 location.assign/replace，直接移除)

    // 3. A 标签点击
    try {
        HTMLAnchorElement.prototype.click = function() {
            if (!isPaused() && isAdUrl(this.href)) return;
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

    // 5. 反反拦截欺骗 (M-15 修复：只在开启且未暂停时生效，configurable 允许后续还原)
    if (!isPaused() && dwSettings.antiBypassEnabled !== false) {
        try {
            Object.defineProperty(window, 'adblock', { get: () => false, configurable: true });
            Object.defineProperty(window, 'canRunAds', { get: () => true, configurable: true });
        } catch(e) {}
    }

    // 6. Skidrow 弹窗劫持防护
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
            if (!isPaused() && target.tagName === 'A' && target.href && isAdUrl(target.href)) {
                e.preventDefault(); e.stopImmediatePropagation();
            }
            if (!isPaused() && target.tagName === 'FORM' && target.action && isAdUrl(target.action)) {
                e.preventDefault(); e.stopImmediatePropagation();
            }
        }
    };
    document.addEventListener('mousedown', interceptClick, true);
    document.addEventListener('click', interceptClick, true);

    // 8. DOM 节点清理
    const killMaliciousNodes = (root) => {
        if (isPaused() || !root) return;
        const links = root.querySelectorAll ? root.querySelectorAll('a, form') : [];
        links.forEach(el => {
            if (el.dataset.dwKilled) return;
            if (el.tagName === 'A' && el.href && isAdUrl(el.href)) {
                el.removeAttribute('href'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
            } else if (el.tagName === 'FORM' && el.action && isAdUrl(el.action)) {
                el.removeAttribute('action'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
            }
        });
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
    if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        killMaliciousNodes(document.documentElement);
    }
})();
})();
