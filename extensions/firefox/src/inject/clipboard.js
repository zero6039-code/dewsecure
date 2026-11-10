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

        // 🛡️ SAN-3 修复：引入 NFKC 标准化与高精度指令分类
        const CLIPBOARD_RISK = [
            [/powershell(\.exe)?\s+.*(-e|-enc|-encodedcommand|iex|invoke-expression|downloadstring)/i, 'powershell'],
            [/\bmshta(\.exe)?\s+(https?:|vbscript:|javascript:)/i, 'mshta'],
            [/\b(curl|wget)\b[^|\n]*\|\s*(ba)?sh\b/i, 'pipe-to-shell'],
            [/\bcmd(\.exe)?\s*\/[ck]\s+/i, 'cmd'],
            [/\b(certutil|bitsadmin|regsvr32|rundll32)\b.*(http|\\\\)/i, 'lolbin'],
            [/\bosascript\s+-e\b|\bbase64\s+-d\b.*\|\s*(ba)?sh/i, 'macos-shell'],
            [/\bwscript(\.exe)?\s+.*\.(vbs|js)/i, 'wscript']
        ];

        function classifyClipboard(text) {
            if (typeof text !== 'string' || text.length > 20000) return null;
            let s = text;
            try {
                // 🛡️ 核心绕过修复：将全角字符（如 ｐｏｗｅｒｓｈｅｌｌ）标准化为半角
                s = text.normalize('NFKC');
            } catch (e) {}
            
            for (const [re, tag] of CLIPBOARD_RISK) {
                if (re.test(s)) return tag;
            }
            return null;
        }

        // 1. 拦截脚本静默写入 clipboard.writeText
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            const originalWriteText = navigator.clipboard.writeText;
            try {
                Object.defineProperty(navigator.clipboard, 'writeText', {
                    value: async function(text) {
                        if (classifyClipboard(text) !== null) {
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
                        if (classifyClipboard(selection) !== null) {
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
                    if (String(format).toLowerCase() === 'text/plain' && classifyClipboard(data) !== null) {
                        console.warn('[DewSecure] 已彻底拦截危险剪贴板写入 (setData):', String(data).substring(0, 50) + '...');
                        showClipboardWarning();
                        // 🛡️ B-7 修复：直接篡改写入内容，彻底阻断恶意代码进入剪贴板
                        return nativeSetData.call(this, format, "[DewSecure] 剪贴板内容已被安全引擎拦截。");
                    }
                } catch (_) {}
                return nativeSetData.apply(this, arguments);
            };
        } catch (e) {}

        
        // 🛡️ SAN-3 修复：捕获原生 copy 事件，防止通过 clipboardData 绕过
        document.addEventListener('copy', (e) => {
            try {
                const sel = document.getSelection();
                const text = sel ? sel.toString() : '';
                if (classifyClipboard(text) !== null) {
                    console.warn('[DewSecure] 拦截到原生危险的 copy 事件');
                    showClipboardWarning();
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            } catch (_) {}
        }, true);

        // 4. A4 修复：诱导语检测改为多信号（CAPTCHA 文案 + Win+R + 覆盖层）
        function checkFixInducement() {
            if (!document.body) return;
            const bodyText = document.body.innerText.toLowerCase();
            if (!bodyText) return;

            // 🛡️ SAN-3 修复：正则连贯匹配 (Win+R ... 粘贴 ... Enter)
            const CLICKFIX_TEXT = /(win(dows)?\s*\+?\s*r|运行对话框).{0,80}(ctrl\s*\+?\s*v|粘贴).{0,80}(enter|回车)/is;
            const hasClickFixText = CLICKFIX_TEXT.test(bodyText);

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

            if (hasClickFixText && hasOverlay) {
                console.warn('[DewSecure] 检测到 ClickFix 诱导语组合 (Win+R + 粘贴 + 覆盖层)');
                showClipboardWarning();
                return;
            }

            // 兜底原有的关键词检测
            const captchaWords = ['captcha', 'verify you are human', '验证您是人类', '人机验证', '我不是机器人', "i'm not a robot"];
            const hasCaptcha = captchaWords.some(w => bodyText.includes(w));
            if (!hasCaptcha) return;

            const winRWords = ['win+r', 'win + r', 'windows + r', 'windows+r'];
            const hasWinR = winRWords.some(w => bodyText.includes(w));
            if (!hasWinR) return;

            if (hasOverlay) {
                console.warn('[DewSecure] 检测到 ClickFix 诱导语（多信号命中）');
                showClipboardWarning();
            }
        }

        // 🛡️ SAN-3 补丁：加入 MutationObserver 监听动态弹出的钓鱼遮罩层
        let fixCheckTimeout;
        function scheduleFixCheck() {
            if (fixCheckTimeout) clearTimeout(fixCheckTimeout);
            fixCheckTimeout = setTimeout(checkFixInducement, 1000);
        }
        
        // 初始检查
        scheduleFixCheck();
        
        // 监听 DOM 变化
        try {
            const observer = new MutationObserver(scheduleFixCheck);
            if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true, characterData: true });
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
                });
            }
        } catch (e) {}

        console.log('🛡️ [DewSecure Inject] 剪贴板防护与 ClickFix 拦截装甲已加载 (A4)');
    } catch (e) {
        console.error('[DewSecure Inject] 剪贴板防护初始化失败:', e);
    }
})();
