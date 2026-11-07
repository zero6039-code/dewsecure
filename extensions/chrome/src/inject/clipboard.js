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
