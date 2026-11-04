window.__dewsecureDict = window.__dewsecureDict || {};
(function() {
    // 11. 挖矿与资源滥用检测 (N-15 升级：计分制)
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
            
            // 计分制：单 Worker(20) + WASM(20) + 长任务(20) = 60 触发
            // 或者 WebSocket 连非 HTTP 端口(40) + 任意一个其它项 = 60 触发
            let score = 0;
            let reasons = [];
            
            if (workerCount > 0) { score += 20; reasons.push('Worker'); }
            if (wasmCount > 0) { score += 20; reasons.push('WASM'); }
            if (longTaskCount > 5) { score += 20; reasons.push('LongTask'); }
            if (socketCount > 0) { score += 40; reasons.push('WebSocket-Mining-Port'); }

            if (score >= 60) {
                isMiningDetected = true;
                console.warn(`[DewSecure] 检测到严重资源滥用 (得分: ${score})，正在终止 Workers... 原因: ${reasons.join(', ')}`);
                // 终止所有 Worker
                for (const w of activeWorkers) {
                    try { w.terminate(); } catch(e) {}
                }
                activeWorkers.clear();
                showMiningWarning();
            }
        }

        // Hook Worker
        const nativeWorker = window.Worker;
        window.Worker = function(url, options) {
            const w = new nativeWorker(url, options);
            workerCount++;
            activeWorkers.add(w);
            w.addEventListener('error', () => activeWorkers.delete(w));
            triggerMiningCheck();
            return w;
        };
        window.Worker.prototype = nativeWorker.prototype;

        // Hook WASM (补全 instantiateStreaming 和 Module)
        if (window.WebAssembly) {
            const nativeInstantiate = WebAssembly.instantiate;
            WebAssembly.instantiate = function() {
                wasmCount++;
                triggerMiningCheck();
                return nativeInstantiate.apply(this, arguments);
            };

            const nativeInstantiateStreaming = WebAssembly.instantiateStreaming;
            if (nativeInstantiateStreaming) {
                WebAssembly.instantiateStreaming = function() {
                    wasmCount++;
                    triggerMiningCheck();
                    return nativeInstantiateStreaming.apply(this, arguments);
                };
            }

            const nativeModule = WebAssembly.Module;
            try {
                WebAssembly.Module = function() {
                    wasmCount++;
                    triggerMiningCheck();
                    return new nativeModule(...arguments);
                };
                WebAssembly.Module.prototype = nativeModule.prototype;
            } catch(e) {}
        }

        // Hook WebSocket (检测常见挖矿端口)
        const nativeWebSocket = window.WebSocket;
        const MINING_PORTS = [3333, 4444, 5555, 7777, 14433, 14444, 45700];
        window.WebSocket = function(url, protocols) {
            try {
                const u = new URL(url);
                const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'wss:' ? 443 : 80);
                if (MINING_PORTS.includes(port)) {
                    socketCount++;
                    triggerMiningCheck();
                }
            } catch(e) {}
            return new nativeWebSocket(url, protocols);
        };
        window.WebSocket.prototype = nativeWebSocket.prototype;

        // 监控 LongTask
        if (window.PerformanceObserver) {
            const obs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.duration > 50) {
                        longTaskCount++;
                        if (longTaskCount > 5) {
                            triggerMiningCheck();
                        }
                    }
                }
            });
            obs.observe({ entryTypes: ['longtask'] });
        }
    } catch (e) {
        console.error('[DewSecure Inject] 挖矿防护初始化失败:', e);
    }
})();

(function() {
    'use strict';
    // 🚀 ClickFix 剪贴板防护与诱导语检测 (N-14 升级)
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

        // 🛡️ N-14 优化：计分制判断，降低误报
        function isDangerousClipboard(text) {
            if (!text) return false;
            const str = String(text);
            let score = 0;

            // 极高危（直接拦截）
            if (/powershell/i.test(str) || /mshta/i.test(str) || /cmd\s*\/c/i.test(str) || /Invoke-WebRequest/i.test(str) || /Start-Process/i.test(str)) score += 50;
            
            // 高危组合
            if (/curl/i.test(str) || /wget/i.test(str)) score += 20;
            if (/\bbash\b/i.test(str) || /\.ps1/i.test(str) || /\.bat/i.test(str) || /\.vbs/i.test(str)) score += 20;
            if (/base64/i.test(str)) score += 20;
            
            // 长 Base64 串
            if (/^[A-Za-z0-9+/]{100,}={0,2}$/.test(str.replace(/\s/g, ''))) score += 40;

            return score >= 50;
        }

        // 1. 拦截脚本静默写入 clipboard.writeText
        if (navigator.clipboard) {
            const originalWriteText = navigator.clipboard.writeText;
            Object.defineProperty(navigator.clipboard, 'writeText', {
                value: async function(text) {
                    const isPaused = document.documentElement.getAttribute('data-dewsecure-paused') === 'true';
                    if (!isPaused && isDangerousClipboard(text)) {
                        console.warn('[DewSecure] 已拦截危险的剪贴板写入:', text.substring(0, 50) + '...');
                        showClipboardWarning();
                        return Promise.reject(new Error('DewSecure: Clipboard write blocked due to suspicious content'));
                    }
                    return originalWriteText.apply(this, arguments);
                },
                writable: true,
                configurable: true
            });
        }

        // 2. 拦截 execCommand('copy')
        const nativeExecCommand = document.execCommand;
        Object.defineProperty(document, 'execCommand', {
            value: function(command, showUI, value) {
                const isPaused = document.documentElement.getAttribute('data-dewsecure-paused') === 'true';
                if (command.toLowerCase() === 'copy' && !isPaused) {
                    const selection = document.getSelection() ? document.getSelection().toString() : '';
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

        // 3. 🛡️ N-14 修复：拦截用户手动按 Ctrl+C 或右键复制
        document.addEventListener('copy', (e) => {
            const isPaused = document.documentElement.getAttribute('data-dewsecure-paused') === 'true';
            if (isPaused) return;

            let text = '';
            if (e.clipboardData) {
                text = e.clipboardData.getData('text/plain');
            }
            if (!text) {
                const selection = document.getSelection();
                text = selection ? selection.toString() : '';
            }

            if (isDangerousClipboard(text)) {
                console.warn('[DewSecure] 已拦截手动复制的危险内容:', text.substring(0, 50) + '...');
                e.preventDefault();
                e.stopPropagation();
                showClipboardWarning();
            }
        }, true);

        // 4. 🛡️ N-14 优化：检测页面上的诱导语 (ClickFix)
        function checkFixInducement() {
            if (document.documentElement.getAttribute('data-dewsecure-paused') === 'true') return;
            const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
            if (!bodyText) return;

            // 多语言特征：按 Win+R / 运行 / 粘贴 / 命令行等
            const indicators = ['win+r', 'win + r', 'windows + r', 'windows+r', 'paste', '粘贴', '貼り付け', '붙여넣기', 'tampal', 'pegar', 'coller', 'einfügen'];
            const isRunDialog = bodyText.includes('run') || bodyText.includes('运行') || bodyText.includes('執行') || bodyText.includes('실행') || bodyText.includes('lari') || bodyText.includes('ejecutar') || bodyText.includes('executar') || bodyText.includes('ausführen') || bodyText.includes('exécuter');
            
            let hitCount = 0;
            for (const word of indicators) {
                if (bodyText.includes(word)) hitCount++;
            }

            // 如果同时提到了“运行”和“粘贴”，且页面没有大量代码块（防误伤文档站）
            if (hitCount >= 1 && isRunDialog) {
                const codeBlocks = document.querySelectorAll('pre, code').length;
                if (codeBlocks < 5) { // 简单粗暴地豁免代码站
                    console.warn('[DewSecure] 检测到 ClickFix 诱导语');
                    showClipboardWarning();
                }
            }
        }

        // 延迟执行一次诱导语检测
        setTimeout(checkFixInducement, 2000);

        console.log('🛡️ [DewSecure Inject] 剪贴板防护与 ClickFix 拦截装甲已加载');
    } catch (e) {
        console.error('[DewSecure Inject] 剪贴板防护初始化失败:', e);
    }
})();

(function() {
    // F-03: 主世界无法调用 chrome.runtime，完全依赖 content.js 通过 postMessage 传递 DEWSECURE_PAUSE 信号

// ===== 白名单热更新接管 =====
let isPaused = false;
// 备份原生方法
const nativeWindowOpen = window.open;
const nativeLocationAssign = window.location.assign;

let dwSettings = { antiHijackEnabled: true, antiBypassEnabled: true, blockSocialTrackers: true };
window.addEventListener('message', (e) => {
    // 🛡️ N-10 修复：严格校验消息来源，防止恶意页面伪造消息关闭防护
    if (e.source !== window || e.origin !== location.origin) return;

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
