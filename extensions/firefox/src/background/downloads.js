// ==========================================
// 🚀 下载与投递链防御 (Download Guard)
// ==========================================
import { consumeForce, grantForce } from './state.js';
import { getDict } from './i18n.js';

export function showDownloadNotification(level, filename, title, message) {
    const iconUrl = chrome.runtime.getURL('icons/icon-128.png');
    chrome.notifications.create({
        type: 'basic',
        iconUrl: iconUrl,
        title: title,
        message: message,
        priority: level === 'danger' ? 2 : 0
    });
}

// 🛡️ A-10 修复：全局限速器，防止恶意网站狂刷弹窗
let lastWarnTime = 0;
function openWarningOnce(url) {
    if (Date.now() - lastWarnTime < 5000) return;
    lastWarnTime = Date.now();
    chrome.tabs.create({ url });
}

export function initDownloads() {
    if(chrome.downloads && chrome.downloads.onDeterminingFilename) {
        chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
            const rawUrl = item.finalUrl || item.url || '';

            // 🛡️ A-11 修复：在下载守卫中消费令牌
            if (consumeForce(rawUrl)) {
                suggest();
                return;
            }

            const rawName = (item.filename || item.suggestedFilename || '');

            // 🛡️ D1 修复 1：RTL 覆盖字符检测
            if (/[\u202A-\u202E\u2066-\u2069]/.test(rawName)) {
                suggest();
                chrome.downloads.cancel(item.id).catch(() => {});
                chrome.downloads.erase({ id: item.id }).catch(() => {});
                showDownloadNotification('danger', rawName, '🚨 RTL 视觉欺骗拦截', '检测到文件名包含隐藏的 RTL 覆盖字符，已被强制阻断。');
                return;
            }

            const name = rawName.split(/[\\/]/).pop().toLowerCase();
            console.log('[DewSecure] 拦截下载检查:', name);

            if (!name) {
                suggest();
                return;
            }

            const dict = getDict();
            
            // 提取后缀
            const isLocalGeneration = rawUrl.startsWith('blob:') || rawUrl.startsWith('data:');
            
            // 🛡️ A-10 修复：移除 .svg 和 .zip 等可能存在风险的后缀，改为“任一不安全”即拦截
            const safeLocalExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.txt', '.csv', '.mp4', '.mp3'];
            const isSafeExt = safeLocalExts.some(ext => name.endsWith(ext));
            const isSafeMime = item.mime && (
                item.mime.startsWith('image/') ||
                item.mime === 'application/pdf' ||
                item.mime === 'text/plain' ||
                item.mime === 'text/csv'
            );

            // 如果是从 Blob/Data 本地生成，且后缀或 MIME 不安全，直接拦截
            if (isLocalGeneration && (!isSafeExt || !isSafeMime)) {
                console.warn('🚨 [Download Guard] 检测到 HTML Smuggling (Blob/Data URL 走私)，强制拦截:', rawUrl);
                grantForce(rawUrl); // 发放令牌
                suggest();
                chrome.downloads.cancel(item.id).catch(() => {});
                chrome.downloads.erase({ id: item.id }).catch(() => {});
                openWarningOnce(chrome.runtime.getURL(`warning.html?type=download&reason=smuggling&filename=${encodeURIComponent(name)}&url=${encodeURIComponent(rawUrl)}`));
                showDownloadNotification('danger', name,
                    dict.phish_download_smuggling_title || '🚨 Malicious Script Blocked',
                    (dict.phish_download_smuggling_desc || 'An inline payload disguised as an executable was blocked.').replace('{filename}', 'Obfuscated Payload')
                );
                return;
            }

            // 2. 检查双扩展名 (如 invoice.pdf.exe)
            const doubleExtRegex = /\.(pdf|docx?|xlsx?|pptx?|jpg|jpeg|png|gif|txt|csv|zip|rar)\.(exe|scr|js|vbs|bat|cmd|lnk|hta|msi|jar|ps1)$/i;
            const isDoubleExt = doubleExtRegex.test(name);

            // 3. 检查高危可执行后缀 (已补全 A-10 遗漏的后缀)
            const highRiskExts = ['.exe', '.msi', '.msix', '.appx', '.vbs', '.vbe', '.wsf', '.hta', '.lnk', '.scr', '.iso', '.img', '.vhd', '.chm', '.jar', '.ps1', '.bat', '.cmd', '.reg', '.apk', '.js', '.jse', '.dll', '.url', '.docm', '.xlsm', '.pptm', '.dmg', '.pkg', '.sh'];
            const isHighRisk = highRiskExts.some(ext => name.endsWith(ext));

            // 如果既不是双扩展名，也不是高危后缀，直接放行
            if (!isDoubleExt && !isHighRisk) {
                suggest();
                return;
            }

            // 仅豁免官方更新域名
            const OFFICIAL_UPDATE_DOMAINS = ['dewsecure.com', 'api.dewsecure.com'];
            let isOfficialOrigin = false;
            try {
                const originUrl = item.referrer || item.url || '';
                if (originUrl && originUrl.startsWith('http')) {
                    const host = new URL(originUrl).hostname;
                    isOfficialOrigin = OFFICIAL_UPDATE_DOMAINS.some(d => host === d || host.endsWith('.' + d));
                }
            } catch (e) {}

            if (isOfficialOrigin) {
                suggest();
                return;
            }

            // 6. 处置逻辑：强制拦截所有高危下载
            grantForce(rawUrl); // 发放强制下载通行证
            
            suggest(); // 先放行，再取消
            chrome.downloads.cancel(item.id)
                .catch(() => { /* 忽略边界错误 */ })
                .finally(() => {
                    chrome.downloads.erase({ id: item.id }).catch(() => {});
                });

            const warningUrl = chrome.runtime.getURL(`warning.html?type=download&filename=${encodeURIComponent(name)}&url=${encodeURIComponent(rawUrl)}`);
            openWarningOnce(warningUrl);

            if (isDoubleExt) {
                showDownloadNotification('danger', name, dict.phish_download_danger_title || '🚨 High-Risk Download Blocked', (dict.phish_download_danger_desc || 'A double extension file ({filename}) was detected.').replace('{filename}', name));
            } else {
                showDownloadNotification('warning', name, dict.phish_download_warn_title || '⚠️ Security Risk', (dict.phish_download_warn_desc || 'You are downloading an executable from an unknown source ({filename}).').replace('{filename}', name));
            }
        });
    }
}
