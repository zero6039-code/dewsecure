import { initNotificationHook } from './hooks/notification.js';
import { initWindowOpenHook } from './hooks/windowOpen.js';
import { initDomNavigationHook } from './hooks/domNavigation.js';
import { initDomCleanupHook } from './hooks/domCleanup.js';

(function() {
    // 🛡️ B-9 终极防御：全局 toString 劫持
    const hookedFns = new WeakSet();
    const nativeToString = Function.prototype.toString;

    Function.prototype.toString = function() {
        if (hookedFns.has(this)) {
            return `function ${this.name || ''}() { [native code] }`;
        }
        return nativeToString.call(this);
    };

    Object.defineProperty(Function.prototype.toString, 'toString', {
        value: function() { return 'function toString() { [native code] }'; },
        writable: false, configurable: false
    });

    // 核心状态管理 (保留在顶层闭包，确保安全)
    let pausedByExtension = false;
    const nativeWindowOpen = window.open;
    let dwSettings = { antiHijackEnabled: true, antiBypassEnabled: true, blockSocialTrackers: true };
    let port = null;

    // 工具函数
    const isPaused = () => pausedByExtension;
    const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|propellerads\.com|adsterra\.com|1xbet\.com|1xlite\.com|omguk\.com|omgt3\.com)$/i;
    const AFFILIATE_PARAMS = ['mmp_pid', 'Allianceid', 'uls_trackid', 'a_aid', 'a_bid', 'affiliate_id', 'from_affiliate', 'tag_aff_id', 'tag_aff_type'];
    
    const isAdUrl = (raw) => {
        if (dwSettings.antiHijackEnabled === false) return false;
        if (raw == null || raw === '') return false;
        try {
            const u = new URL(String(raw), location.href);
            if (u.origin === location.origin) return false;
            return AD_HOSTS.test(u.hostname) || AFFILIATE_PARAMS.some((p) => u.searchParams.has(p));
        } catch (_) {
            return false;
        }
    };

    // 构建共享上下文，传递给所有 Hook 模块
    const ctx = {
        hookedFns,
        nativeWindowOpen,
        get port() { return port; },
        set port(val) { port = val; },
        get dwSettings() { return dwSettings; },
        set dwSettings(val) { dwSettings = val; },
        isPaused,
        isAdUrl,
        AD_HOSTS,
        AFFILIATE_PARAMS
    };

    // 🛡️ B-4 修复：MessageChannel 私有通道握手
    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        const targetOrigin = location.origin === 'null' ? '*' : location.origin;
        if (e.origin !== targetOrigin && targetOrigin !== '*') return;
        if (!e.data) return;

        if (e.data.type === 'DEWSECURE_I18N' && e.data.dict) {
            console.log(`🛡️ [DewSecure Inject] 主世界成功接收字典 (Keys: ${Object.keys(e.data.dict).length})`);
            window.__dewsecureDict = e.data.dict;
        }

        if (e.data.type === 'DEWSECURE_PORT_INIT' && !port && e.ports && e.ports[0]) {
            e.stopImmediatePropagation();
            ctx.port = e.ports[0];
            ctx.port.onmessage = (msg) => {
                if (msg.data?.type === 'DEWSECURE_PAUSE') {
                    pausedByExtension = true;
                    try {
                        Object.defineProperty(window, 'open', { value: nativeWindowOpen, writable: true, configurable: true });
                    } catch (err) {
                        try { window.open = nativeWindowOpen; } catch (_) {}
                    }
                    console.log('[DewSecure Inject] 主世界已挂起，恢复原生 API');
                }
                if (msg.data?.type === 'DEWSECURE_SETTINGS') {
                    ctx.dwSettings = msg.data.settings || {};
                }
                if (msg.data?.type === 'DEWSECURE_I18N') {
                    window.__dewsecureDict = msg.data.dict || {};
                }
            };
        }
    }, true);

    const hello = () => { if (!port) window.postMessage({ type: 'DEW_HELLO' }, '*'); };
    hello(); setTimeout(hello, 50); setTimeout(hello, 250);

    // 核心业务逻辑编排
    (function() {
        'use strict';
        if (window.location.hostname === 'dewsecure.com' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return;
        }
        if (window.__dewsecureInjected) return;
        window.__dewsecureInjected = true;

        // 按顺序初始化各功能模块
        initNotificationHook(ctx);
        initWindowOpenHook(ctx);
        initDomNavigationHook(ctx);
        initDomCleanupHook(ctx);
    })();
})();
