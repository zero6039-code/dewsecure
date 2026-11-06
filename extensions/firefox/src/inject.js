window.__dewsecureDict = window.__dewsecureDict || {};
(function() {
    // 11. 挖矿与资源滥用检测 (A5 修复：不自动终止；A1 修复：Proxy 包装保留静态成员)
    try {
        let workerCount = 0;
        let wasmCount = 0;
        let longTaskCount = 0;
        let socketCount = 0;
        let isMiningDetected = false;
        const activeWorkers = new Set();

        function getMiningI18n() {
            return {
                title: window.__dewsecureDict['mining_title'] || 'Resource Abuse Warning',
                desc: window.__dewsecureDict['mining_desc'] || 'This page is running high-intensity computational tasks...',
                btn: window.__dewsecureDict['mining_btn'] || 'Got it'
            };
        }

        function showMiningWarning() {
            const bannerId = 'dewsecure-mining-warning';
            if (document.getElementById(bannerId)) return;
            const banner = document.createElement('div');
            banner.id = bannerId;
            banner.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
                background: #f59e0b; color: white; padding: 12px 20px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 14px; display: flex; justify-content: space-between; align-items: center;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            `;
            const t = getMiningI18n();
            banner.innerHTML = `
                <div>
                    <strong>⛔ ${t.title}</strong>
                    <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">${t.desc}</div>
                </div>
                <button id="dewsecure-mining-ignore" style="background: transparent; border: 1px solid white; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;">${t.btn}</button>
            `;
            document.body.appendChild(banner);
            document.getElementById('dewsecure-mining-ignore').addEventListener('click', () => banner.remove());
        }

        function triggerMiningCheck() {
            if (isMiningDetected) return;
            // A5 修复：矿池协议/端口权重最高，资源使用只作辅助，且不自动终止
            let score = 0;
            let reasons = [];
            if (socketCount > 0) { score += 50; reasons.push('Mining-Pool-Port'); }
            if (workerCount >= 2) { score += 15; reasons.push('Worker>=2'); }
            if (wasmCount > 0) { score += 10; reasons.push('WASM'); }
            if (longTaskCount > 10) { score += 10; reasons.push('LongTask>10'); }

            if (score >= 60) {
                isMiningDetected = true;
                console.warn(`[DewSecure] 检测到疑似资源滥用 (得分: ${score})，仅提示不终止。原因: ${reasons.join(', ')}`);
                showMiningWarning();
            }
        }

        // A1 修复：Proxy 包装 Worker，保留 prototype / 静态成员 / name
        if (typeof window.Worker === 'function') {
            const NativeWorker = window.Worker;
            try {
                window.Worker = new Proxy(NativeWorker, {
                    construct(target, args, newTarget) {
                        const w = Reflect.construct(target, args, newTarget);
                        workerCount++;
                        activeWorkers.add(w);
                        try { w.addEventListener('error', () => activeWorkers.delete(w)); } catch (_) {}
                        triggerMiningCheck();
                        return w;
                    }
                });
            } catch (e) {}
        }

        // A1 修复：只包装 WebAssembly 的编译/实例化入口，不替换 Module
        if (window.WebAssembly) {
            for (const name of ['compile', 'instantiate', 'instantiateStreaming']) {
                const orig = WebAssembly[name];
                if (typeof orig !== 'function') continue;
                try {
                    WebAssembly[name] = new Proxy(orig, {
                        apply(target, thisArg, args) {
                            wasmCount++;
                            triggerMiningCheck();
                            return Reflect.apply(target, thisArg, args);
                        }
                    });
                } catch (e) {}
            }
        }

        // A1 修复：Proxy 包装 WebSocket，保留 OPEN / CONNECTING / CLOSED 等静态成员
        if (typeof window.WebSocket === 'function') {
            const NativeWS = window.WebSocket;
            const MINING_PORTS = [3333, 4444, 5555, 7777, 14433, 14444, 45700];
            try {
                window.WebSocket = new Proxy(NativeWS, {
                    construct(target, args, newTarget) {
                        try {
                            const u = new URL(String(args[0]));
                            const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'wss:' ? 443 : 80);
                            if (MINING_PORTS.includes(port)) {
                                socketCount++;
                                triggerMiningCheck();
                            }
                        } catch (_) {}
                        return Reflect.construct(target, args, newTarget);
                    }
                });
            } catch (e) {}
        }

        // LongTask 监控：阈值提高到 >10，降低误报
        if (window.PerformanceObserver) {
            try {
                const obs = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.duration > 50) {
                            longTaskCount++;
                            if (longTaskCount > 10) triggerMiningCheck();
                        }
                    }
                });
                obs.observe({ entryTypes: ['longtask'] });
            } catch (e) {}
        }
    } catch (e) {
        console.error('[DewSecure Inject] 挖矿防护初始化失败:', e);
    }
})();

(function() {
    'use strict';
    // 🚀 ClickFix 剪贴板防护与诱导语检测 (A4 修复)
    try {
        function getI18nText() {
            return {
                title: window.__dewsecureDict['clipboard_title'] || 'Security Alert: Dangerous Clipboard Action',
                desc: window.__dewsecureDict['clipboard_desc'] || 'This content contains suspicious commands...',
                btn: window.__dewsecureDict['clipboard_btn'] || 'I am sure it\'s safe, continue'
            };
        }

        function showClipboardWarning() {
            const bannerId = 'dewsecure-clipboard-warning';
            if (document.getElementById(bannerId)) return;
            const banner = document.createElement('div');
            banner.id = bannerId;
            banner.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
                background: #ef4444; color: white; padding: 12px 20px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 14px; display: flex; justify-content: space-between; align-items: center;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            `;
            const t = getI18nText();
            banner.innerHTML = `
                <div>
                    <strong>🚨 ${t.title}</strong>
                    <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">${t.desc}</div>
                </div>
                <button id="dewsecure-clipboard-ignore" style="background: transparent; border: 1px solid white; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;">${t.btn}</button>
            `;
            document.body.appendChild(banner);
            document.getElementById('dewsecure-clipboard-ignore').addEventListener('click', () => banner.remove());
            setTimeout(() => { if (banner.parentNode) banner.remove(); }, 10000);
        }

        // A4 修复：只看"隐藏执行"特征组合，不再因 powershell 一词误拦开发文档
        function isDangerousClipboard(text) {
            if (!text) return false;
            const s = String(text);
            if (s.length < 20) return false;

            const hasExec = /(powershell|pwsh|mshta|wscript|cscript)/i.test(s);
            if (!hasExec) return false;

            return /-w(?:indowstyle)?\s+hidden/i.test(s) ||
                   /-e(?:nc|ncodedcommand)\b/i.test(s) ||
                   /mshta\s+https?:/i.test(s) ||
                   /FromBase64String/i.test(s);
        }

        // 1. 拦截脚本静默写入 clipboard.writeText
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            const originalWriteText = navigator.clipboard.writeText;
            try {
                Object.defineProperty(navigator.clipboard, 'writeText', {
                    value: async function(text) {
                        if (isDangerousClipboard(text)) {
                            console.warn('[DewSecure] 已拦截危险的剪贴板写入:', String(text).substring(0, 50) + '...');
                            showClipboardWarning();
                            return Promise.reject(new Error('DewSecure: Clipboard write blocked due to suspicious content'));
                        }
                        return originalWriteText.apply(this, arguments);
                    },
                    writable: true,
                    configurable: true
                });
            } catch (e) {}
        }

        // 2. 拦截 execCommand('copy')
        const nativeExecCommand = document.execCommand;
        try {
            Object.defineProperty(document, 'execCommand', {
                value: function(command) {
                    if (String(command).toLowerCase() === 'copy') {
                        const sel = document.getSelection();
                        const selection = sel ? sel.toString() : '';
                        if (isDangerousClipboard(selection)) {
                            console.warn('[DewSecure] 已拦截危险的 execCommand 复制:', selection.substring(0, 50) + '...');
                            showClipboardWarning();
                            return false;
                        }
                    }
                    return nativeExecCommand.apply(this, arguments);
                },
                writable: true,
                configurable: true
            });
        } catch (e) {}

        // 3. A4 修复：钉住 DataTransfer.setData，在页面写入瞬间判断
        //    取代捕获阶段 copy 监听器（那里 clipboardData 为空，且会误拦用户手动复制）
        try {
            const nativeSetData = DataTransfer.prototype.setData;
            DataTransfer.prototype.setData = function(format, data) {
                try {
                    if (String(format).toLowerCase() === 'text/plain' && isDangerousClipboard(data)) {
                        console.warn('[DewSecure] 检测到危险剪贴板写入尝试:', String(data).substring(0, 50) + '...');
                        showClipboardWarning();
                    }
                } catch (_) {}
                return nativeSetData.apply(this, arguments);
            };
        } catch (e) {}

        // 4. A4 修复：诱导语检测改为多信号（CAPTCHA 文案 + Win+R + 覆盖层）
        function checkFixInducement() {
            if (!document.body) return;
            const bodyText = document.body.innerText.toLowerCase();
            if (!bodyText) return;

            const captchaWords = ['captcha', 'verify you are human', '验证您是人类', '人机验证', '我不是机器人', "i'm not a robot"];
            const hasCaptcha = captchaWords.some(w => bodyText.includes(w));
            if (!hasCaptcha) return;

            const winRWords = ['win+r', 'win + r', 'windows + r', 'windows+r'];
            const hasWinR = winRWords.some(w => bodyText.includes(w));
            if (!hasWinR) return;

            let hasOverlay = false;
            try {
                const candidates = document.querySelectorAll('div, section, dialog');
                for (const el of candidates) {
                    const style = window.getComputedStyle(el);
                    if (style.position === 'fixed' && parseInt(style.zIndex || '0', 10) > 1000 &&
                        el.offsetWidth > window.innerWidth * 0.5) {
                        hasOverlay = true;
                        break;
                    }
                }
            } catch (_) {}
            if (!hasOverlay) return;

            console.warn('[DewSecure] 检测到 ClickFix 诱导语（多信号命中）');
            showClipboardWarning();
        }

        setTimeout(checkFixInducement, 2000);

        console.log('🛡️ [DewSecure Inject] 剪贴板防护与 ClickFix 拦截装甲已加载 (A4)');
    } catch (e) {
        console.error('[DewSecure Inject] 剪贴板防护初始化失败:', e);
    }
})();

(function() {
    // F-03: 主世界无法调用 chrome.runtime，完全依赖 content.js 通过 postMessage 传递 DEWSECURE_PAUSE 信号

    // A2 修复（inject 侧）：暂停状态只由扩展消息设置，不再读取页面可写的 DOM 属性
    let pausedByExtension = false;
    const nativeWindowOpen = window.open;
    const nativeLocationAssign = window.location.assign;

    let dwSettings = { antiHijackEnabled: true, antiBypassEnabled: true, blockSocialTrackers: true };
    
    // 🛡️ A2 终极修复：验证动态 Token，无视伪造消息
    let validToken = null;

    window.addEventListener('message', (e) => {
        if (e.source !== window || e.origin !== location.origin) return;
        if (!e.data) return;

        // 1. 接收真实 Token
        if (e.data.type === 'DEWSECURE_INIT_TOKEN') {
            validToken = e.data.token;
            return;
        }

        // 2. 校验 Token，无 Token 或 Token 错误的一律丢弃（页面伪造无效）
        if (validToken && e.data.token !== validToken) {
            // console.log('[DewSecure] 丢弃伪造消息:', e.data.type);
            return;
        }

        if (e.data.type === 'DEWSECURE_PAUSE') {
            pausedByExtension = true;
            try {
                Object.defineProperty(window, 'open', { value: nativeWindowOpen, writable: true, configurable: true });
            } catch (err) {
                try { window.open = nativeWindowOpen; } catch (_) {}
            }
            console.log('[DewSecure Inject] 主世界已挂起，恢复原生 API');
        }
        if (e.data.type === 'DEWSECURE_SETTINGS') {
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

        // A2 修复：不再读取 data-dewsecure-paused DOM 属性
        function isPaused() {
            return pausedByExtension;
        }

        // H-1 修复：只拦第三方广告主机或已知联盟参数
        const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|propellerads\.com|adsterra\.com|1xbet\.com|1xlite\.com|omguk\.com|omgt3\.com)$/i;
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
                if (!isPaused() && isSkidrow) {
                    // 🛡️ 行为特征秒杀：Skidrow 上的任何跨域 popup 一律秒杀
                    if (url && !String(url).startsWith(location.origin) && !String(url).includes('skidrowreloaded.com')) {
                        console.warn('[DewSecure] 彻底封锁 Skidrow 跨域弹窗:', url);
                        return null;
                    }
                }
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
                    // 任何非 _self 的 target (如 _blank, 自定义窗口名) 且是跨域链接，全部拦截
                    if (this.target && this.target !== '_self' && this.href && !this.href.startsWith(location.origin)) {
                        if (window.event && window.event.isTrusted) {
                            // 真实点击放行
                        } else {
                            console.warn('[DewSecure] 拦截脚本模拟的跨域弹窗:', this.href);
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
                if (window.location.hostname.includes('skidrowreloaded.com')) {
                    if (target.tagName === 'A' && target.href && !target.href.startsWith(location.origin)) {
                        // 🛡️ 行为特征秒杀：在 Skidrow 上，只要是跨域 <a> 标签，不管是不是真实点击，只要想开新窗口或带追踪参数，全部封杀
                        const isTracking = AFFILIATE_PARAMS.some(p => target.href.includes(p)) || target.href.includes('utm_');
                        if ((target.target && target.target !== '_self') || e.ctrlKey || e.metaKey || isTracking) {
                            console.warn('[DewSecure] 根据行为特征彻底封杀恶意跳转:', target.href);
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
            // 🛡️ 行为特征秒杀：拦截全屏透明点击劫持
            else if (el.tagName === 'A' && el.href) {
                try {
                    const style = window.getComputedStyle(el);
                    // 如果是一个面积巨大、并且完全透明的链接（典型点击劫持）
                    if (parseFloat(style.opacity) < 0.1 && 
                        (parseInt(style.width) > window.innerWidth * 0.5 || parseInt(style.height) > window.innerHeight * 0.5)) {
                        console.warn('[DewSecure] 检测到点击劫持(Clickjacking) 透明层，已摧毁:', el.href);
                        el.removeAttribute('href'); 
                        el.style.setProperty('pointer-events', 'none', 'important'); 
                        el.dataset.dwKilled = 'true';
                    }
                } catch (e) {}
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

// ============================================================================
// A3 修复：拦截 fetch / XHR / sendBeacon 的跨域密码外传
// ============================================================================
(function() {
    'use strict';
    if (window.location.hostname === 'dewsecure.com' || window.location.hostname === 'localhost') return;

    // 简单的取根域方法
    const getBase = h => {
        if (!h) return '';
        const parts = h.split('.');
        return parts.length > 2 ? parts.slice(-2).join('.') : h;
    };

    function showLeakWarning(targetHost) {
        if (document.getElementById('dewsecure-leak-warning')) return;
        const banner = document.createElement('div');
        banner.id = 'dewsecure-leak-warning';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#dc2626;color:white;padding:12px 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;display:flex;align-items:center;box-shadow:0 4px 6px rgba(0,0,0,0.3);';
        
        // 接入多语言字典
        const tTitle = window.__dewsecureDict['leak_title'] || 'Security Alert: DewSecure Blocked Data Leak';
        const tDesc = (window.__dewsecureDict['leak_desc'] || 'This page attempted to send your password to a third-party server ({host}).').replace('{host}', targetHost);
        const tBtn = window.__dewsecureDict['leak_btn'] || 'Got it';

        // 🛡️ C3 修复：使用安全 DOM 操作
        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = 'flex: 1; text-align: center; padding-right: 20px;';
        
        const titleStrong = document.createElement('strong');
        titleStrong.textContent = '🚨 ' + tTitle;
        contentDiv.appendChild(titleStrong);
        
        const descDiv = document.createElement('div');
        descDiv.style.cssText = 'font-size: 12px; opacity: 0.9; margin-top: 4px;';
        descDiv.textContent = tDesc;
        contentDiv.appendChild(descDiv);

        const btn = document.createElement('button');
        btn.id = 'dewsecure-leak-ignore';
        btn.style.cssText = 'background: transparent; border: 1px solid white; color: white; padding: 6px 16px; border-radius: 4px; cursor: pointer; white-space: nowrap; font-size: 13px;';
        btn.textContent = tBtn;

        banner.appendChild(contentDiv);
        banner.appendChild(btn);
        document.body ? document.body.appendChild(banner) : document.documentElement.appendChild(banner);
        
        document.getElementById('dewsecure-leak-ignore').addEventListener('click', () => banner.remove());
    }

    // 核心检测逻辑
    function isCredentialLeak(url, body) {
        if (!url || !body) return false;
        try {
            const target = new URL(String(url), location.href);
            // 同域不拦（允许正常的登录）
            if (getBase(target.hostname) === getBase(location.hostname)) return false;
            
            // 获取当前页面所有的密码值（长度大于 3 的才算有效密码）
            const pws = Array.from(document.querySelectorAll('input[type="password"]')).map(i => i.value).filter(v => v && v.length >= 4);
            if (pws.length === 0) return false;

            let bodyStr = '';
            if (typeof body === 'string') {
                bodyStr = body;
            } else if (body instanceof URLSearchParams) {
                bodyStr = body.toString();
            } else if (body instanceof FormData) {
                for (let [k, v] of body.entries()) bodyStr += k + '=' + String(v) + '&';
            } else {
                return false; // 暂不解析 Blob 等复杂二进制数据，避免影响性能
            }

            // 检查请求体中是否包含真实的密码
            for (const pw of pws) {
                if (bodyStr.includes(pw)) {
                    console.warn('[DewSecure] 🚨 拦截到跨域密码外传! 目标:', target.hostname);
                    showLeakWarning(target.hostname);
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    // 1. Hook fetch
    const nativeFetch = window.fetch;
    if (nativeFetch) {
        window.fetch = function(input, init) {
            let url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
            let body = init && init.body ? init.body : (input instanceof Request ? null : null);
            
            // 处理 Request 对象中的 body（如果有）
            if (input instanceof Request && !body) {
                try { body = input.clone().text(); } catch (_) {}
            }
            
            if (isCredentialLeak(url, body)) {
                return Promise.reject(new Error('DewSecure: Blocked cross-origin credential transmission'));
            }
            return nativeFetch.apply(this, arguments);
        };
    }

    // 2. Hook XMLHttpRequest
    const nativeXHROpen = XMLHttpRequest.prototype.open;
    const nativeXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
        this.__dw_url = url;
        return nativeXHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
        if (isCredentialLeak(this.__dw_url, body)) {
            throw new Error('DewSecure: Blocked cross-origin credential transmission');
        }
        return nativeXHRSend.apply(this, arguments);
    };

    // 3. Hook sendBeacon
    const nativeBeacon = navigator.sendBeacon;
    if (nativeBeacon) {
        navigator.sendBeacon = function(url, data) {
            if (isCredentialLeak(url, data)) {
                return false;
            }
            return nativeBeacon.apply(this, arguments);
        };
    }
})();
