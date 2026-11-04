(function() {

    // 11. 挖矿与资源滥用检测 (Worker + WASM + LongTask)
    try {
        let workerCount = 0;
        let wasmCount = 0;
        let longTaskCount = 0;
        let isMiningDetected = false;
        const activeWorkers = new Set();

        const MINING_I18N = {
            'zh': { title: '资源滥用警告：检测到疑似挖矿脚本', desc: '该页面正在后台运行高强度的计算任务（消耗大量 CPU），可能试图挖掘加密货币。DewSecure 已自动终止了这些任务。', btn: '我知道了' },
            'en': { title: 'Resource Abuse Warning: Suspected Mining Script', desc: 'This page is running high-intensity computational tasks in the background (consuming CPU), possibly trying to mine cryptocurrency. DewSecure has automatically terminated these tasks.', btn: 'Got it' },
            'de': { title: 'Ressourcenmissbrauch: Verdächtiges Mining-Skript', desc: 'Diese Seite führt im Hintergrund rechenintensive Aufgaben aus (CPU-Verbrauch), möglicherweise um Kryptowährungen zu schürfen. DewSecure hat diese Aufgaben automatisch beendet.', btn: 'Verstanden' },
            'es': { title: 'Advertencia de abuso de recursos: Script de minería', desc: 'Esta página está ejecutando tareas computacionales de alta intensidad en segundo plano, posiblemente para minar criptomonedas. DewSecure ha terminado estas tareas automáticamente.', btn: 'Entendido' },
            'fr': { title: 'Avertissement d\'abus de ressources : Script de minage', desc: 'Cette page exécute des tâches de calcul intensif en arrière-plan, essayant peut-être de miner des cryptomonnaies. DewSecure a automatiquement mis fin à ces tâches.', btn: 'Compris' },
            'ja': { title: 'リソース乱用警告：マイニングスクリプトの疑い', desc: 'このページはバックグラウンドで高負荷な計算タスクを実行しており、暗号通貨をマイニングしようとしている可能性があります。DewSecureはこれらのタスクを自動的に終了しました。', btn: '了解' },
            'ko': { title: '리소스 남용 경고: 채굴 스크립트 의심', desc: '이 페이지는 백그라운드에서 고강도 컴퓨팅 작업을 실행하고 있으며, 암호화폐를 채굴하려는 것일 수 있습니다. DewSecure가 이 작업을 자동으로 종료했습니다.', btn: '확인' },
            'ms': { title: 'Amaran Penyalahgunaan Sumber: Skrip Perlombongan', desc: 'Halaman ini menjalankan tugas pengiraan berintensiti tinggi di latar belakang, mungkin cuba melombong mata wang kripto. DewSecure telah menamatkan tugas ini secara automatik.', btn: 'Faham' },
            'pt': { title: 'Aviso de Abuso de Recursos: Script de Mineração', desc: 'Esta página está executando tarefas computacionais de alta intensidade em segundo plano, possivelmente para minerar criptomoedas. O DewSecure encerrou essas tarefas automaticamente.', btn: 'Entendi' }
        };

        function getMiningI18n() {
            const lang = (navigator.language || 'en').split('-')[0].toLowerCase();
            return MINING_I18N[lang] || MINING_I18N['en'];
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

        // Hook Worker
        const nativeWorker = window.Worker;
        window.Worker = function(url, options) {
            const w = new nativeWorker(url, options);
            workerCount++;
            activeWorkers.add(w);
            w.addEventListener('error', () => activeWorkers.delete(w));
            return w;
        };
        window.Worker.prototype = nativeWorker.prototype;

        // Hook WebAssembly.instantiate
        const nativeWasmInstantiate = WebAssembly.instantiate;
        WebAssembly.instantiate = function(buffer, imports) {
            wasmCount++;
            if (workerCount >= 2 && wasmCount >= 1 && !isMiningDetected) {
                triggerMiningCheck();
            }
            return nativeWasmInstantiate.apply(this, arguments);
        };

        // 监控 LongTask
        if (window.PerformanceObserver) {
            const obs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.duration > 50) {
                        longTaskCount++;
                        if (longTaskCount > 5 && !isMiningDetected) {
                            triggerMiningCheck();
                        }
                    }
                }
            });
            obs.observe({ entryTypes: ['longtask'] });
        }

        function triggerMiningCheck() {
            if (isMiningDetected) return;
            if (workerCount >= 2 && wasmCount >= 1 && longTaskCount >= 5) {
                isMiningDetected = true;
                console.warn('[DewSecure] 检测到严重资源滥用，正在终止 Workers...');
                // 终止所有 Worker
                for (const w of activeWorkers) {
                    try { w.terminate(); } catch(e) {}
                }
                activeWorkers.clear();
                showMiningWarning();
            }
        }
    } catch (e) {
        console.error('[DewSecure Inject] 挖矿防护初始化失败:', e);
    }

})();

(function() {
    'use strict';
    // 🚀 ClickFix 剪贴板防护 (提升至最顶层，确保绝对执行)
    try {
        const DANGEROUS_CLIPBOARD_PATTERNS = [
            /powershell/i, /mshta/i, /cmd\s*\/c/i, /curl/i, /wget/i,
            /Invoke-WebRequest/i, /Start-Process/i, /base64/i, /\bbash\b/i, /\.ps1/i, /\.bat/i, /\.vbs/i
        ];
        const LONG_BASE64_PATTERN = /^[A-Za-z0-9+/]{100,}={0,2}$/;

        function isDangerousClipboard(text) {
            if (!text) return false;
            const str = String(text);
            if (DANGEROUS_CLIPBOARD_PATTERNS.some(regex => regex.test(str))) return true;
            if (LONG_BASE64_PATTERN.test(str.replace(/\s/g, ''))) return true;
            return false;
        }


        const CLIPBOARD_I18N = {
            'zh': { title: '安全警告：DewSecure 拦截了一次危险的剪贴板复制。', desc: '该内容包含可疑指令（如 PowerShell/CMD），请勿将其粘贴到运行窗口。', btn: '我确定安全，继续' },
            'en': { title: 'Security Alert: DewSecure blocked a dangerous clipboard copy.', desc: 'This content contains suspicious commands (e.g., PowerShell/CMD). Do not paste it into the run window.', btn: 'I am sure it\'s safe, continue' },
            'de': { title: 'Sicherheitswarnung: DewSecure hat eine gefährliche Zwischenablage-Kopie blockiert.', desc: 'Dieser Inhalt enthält verdächtige Befehle (z. B. PowerShell/CMD). Fügen Sie ihn nicht in das Ausführungsfenster ein.', btn: 'Ich bin sicher, fortfahren' },
            'es': { title: 'Alerta de seguridad: DewSecure bloqueó una copia peligrosa en el portapapeles.', desc: 'Este contenido contiene comandos sospechosos (ej. PowerShell/CMD). No lo pegues en la ventana de ejecución.', btn: 'Estoy seguro, continuar' },
            'fr': { title: 'Alerte de sécurité : DewSecure a bloqué une copie de presse-papiers dangereuse.', desc: 'Ce contenu contient des commandes suspectes (ex. PowerShell/CMD). Ne le collez pas dans la fenêtre d\'exécution.', btn: 'Je suis sûr, continuer' },
            'ja': { title: 'セキュリティ警告：DewSecureが危険なクリップボードのコピーをブロックしました。', desc: 'このコンテンツには疑わしいコマンド（PowerShell/CMDなど）が含まれています。実行ウィンドウに貼り付けないでください。', btn: '安全です、続行します' },
            'ko': { title: '보안 경고: DewSecure가 위험한 클립보드 복사를 차단했습니다.', desc: '이 콘텐츠에는 의심스러운 명령(PowerShell/CMD 등)이 포함되어 있습니다. 실행 창에 붙여넣지 마십시오.', btn: '안전합니다, 계속' },
            'ms': { title: 'Amaran Keselamatan: DewSecure menyekat salinan papan keratan yang berbahaya.', desc: 'Kandungan ini mengandungi arahan yang mencurigakan (cth. PowerShell/CMD). Jangan tampal ke tetingkap larian.', btn: 'Saya pasti selamat, teruskan' },
            'pt': { title: 'Alerta de Segurança: O DewSecure bloqueou uma cópia perigosa da área de transferência.', desc: 'Este conteúdo contém comandos suspeitos (ex. PowerShell/CMD). Não o cole na janela de execução.', btn: 'Tenho certeza, continuar' }
        };

        function getI18nText() {
            const lang = (navigator.language || 'en').split('-')[0].toLowerCase();
            return CLIPBOARD_I18N[lang] || CLIPBOARD_I18N['en'];
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

        // 拦截 navigator.clipboard.writeText
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

        // 拦截 document.execCommand('copy')
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
        console.log('🛡️ [DewSecure Inject] 剪贴板防护装甲已加载');
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
