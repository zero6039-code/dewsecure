(function() {
    'use strict';
    // 🚀 ClickFix 剪贴板防护与诱导语检测 (A4 修复)
    try {
        function getI18nText() {
            const dict = window.__dewsecureDict || {};
            return {
                title: dict['clipboard_title'] || 'Security Alert: DewSecure blocked a dangerous clipboard action.',
                desc: dict['clipboard_desc'] || 'This content contains suspicious commands (e.g., PowerShell/CMD). Do not paste it into the run window.',
                btn: dict['clipboard_btn'] || 'I am sure it\'s safe, continue'
            };
        }

        function showClipboardWarning() {
            const bannerId = 'dewsecure-clipboard-warning';
            if (document.getElementById(bannerId)) return;

            const t = getI18nText();
            const host = document.createElement('aside');
            host.id = bannerId;
            host.style.cssText = 'display: block !important; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; z-index: 2147483647 !important;';
            const shadow = host.attachShadow({ mode: 'closed' });

            const banner = document.createElement('div');
            banner.style.cssText = `background: #ef4444; color: white; padding: 12px 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1);`;

            const leftDiv = document.createElement('div');
            leftDiv.style.cssText = 'display: flex; align-items: center; gap: 12px;';

            // 安全创建 SVG 图标
            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('width', '28');
            svg.setAttribute('height', '28');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.style.cssText = 'flex-shrink: 0;';
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z');
            svg.appendChild(path);

            const textDiv = document.createElement('div');
            const titleStrong = document.createElement('strong');
            titleStrong.textContent = t.title;
            const descDiv = document.createElement('div');
            descDiv.style.cssText = 'font-size: 12px; opacity: 0.8; margin-top: 4px;';
            descDiv.textContent = t.desc;
            textDiv.appendChild(titleStrong);
            textDiv.appendChild(descDiv);

            leftDiv.appendChild(svg);
            leftDiv.appendChild(textDiv);

            const btn = document.createElement('button');
            btn.id = 'dewsecure-clipboard-ignore';
            btn.style.cssText = 'background: transparent; border: 1px solid white; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;';
            btn.textContent = t.btn;

            banner.appendChild(leftDiv);
            banner.appendChild(btn);
            shadow.appendChild(banner);

            const mountTarget = document.documentElement;
            if (mountTarget) mountTarget.appendChild(host);

            // 绑定点击事件
            const ignoreBtn = shadow.getElementById('dewsecure-clipboard-ignore');
            if (ignoreBtn) ignoreBtn.addEventListener('click', () => host.remove());

            // 自动移除
            setTimeout(() => { if (host.parentNode) host.remove(); }, 10000);
        }

        // A4 修复：只看"隐藏执行"特征组合，不再因 powershell 一词误拦开发文档
        function isDangerousClipboard(text) {
            if (!text) return false;
            const s = String(text);
            if (s.length < 15) return false;
            const lower = s.toLowerCase();

            // 🛡️ B-7 修复：Windows 高危命令链
            const winExec = /powershell|pwsh|cmd\s*\/c|mshta|wscript|cscript|msiexec|certutil|rundll32|bitsadmin/i.test(lower);
            const winDanger = /-w(?:indowstyle)?\s+hidden|-e(?:nc|ncodedcommand)|frombase64string|downloadstring|invoke-webrequest|iwr\s+/i.test(lower);
            const winDownloadExec = /http:\/\/|https:\/\//i.test(lower) && /\.exe|\.bat|\.ps1|\.vbs|\.msi/i.test(lower);
            
            if (winExec && winDanger) return true;
            if (winExec && winDownloadExec) return true;

            // 🛡️ B-7 修复：macOS / Linux 高危命令链
            const unixDanger = /curl\s+.*?\|\s*(bash|sh|zsh)|wget\s+.*?\|\s*(bash|sh)|eval\s*\(|osascript/i.test(lower);
            if (unixDanger) return true;

            return false;
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
                        console.warn('[DewSecure] 已彻底拦截危险剪贴板写入 (setData):', String(data).substring(0, 50) + '...');
                        showClipboardWarning();
                        // 🛡️ B-7 修复：直接篡改写入内容，彻底阻断恶意代码进入剪贴板
                        return nativeSetData.call(this, format, "[DewSecure] 剪贴板内容已被安全引擎拦截。");
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
