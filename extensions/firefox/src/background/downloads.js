// ==========================================
// 🚀 下载与投递链防御 (Download Guard)
// ==========================================
import { forceDownloadUrls } from './state.js';
import { getDict } from './i18n.js';

export function showDownloadNotification(level, filename, title, message) {
    // 🛡️ 修复 MV3 CSP 限制：不能使用 data: 开头的 Base64 图片，必须使用扩展本地的静态图标
    const iconUrl = chrome.runtime.getURL('icons/icon-128.png');

    chrome.notifications.create({
        type: 'basic',
        iconUrl: iconUrl,
        title: title,
        message: message,
        priority: level === 'danger' ? 2 : 0
    });
}

export function initDownloads() {
    if(chrome.downloads && chrome.downloads.onDeterminingFilename) chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
        // 🛡️ N-4 修复：检查是否为用户强制放行的下载
        const rawUrl = item.finalUrl || item.url || '';
        if (forceDownloadUrls.has(rawUrl)) {
            forceDownloadUrls.delete(rawUrl); // 一次性通行证
            suggest();
            return;
        }

        // 🛡️ N-4 修复：提取真正的文件名（取路径最后一段）
        const rawName = (item.filename || item.suggestedFilename || '');

        // 🛡️ D1 修复 1：RTL 覆盖字符检测 (如 invoice‮fdp.exe)
        // 攻击者用这种手段在视觉上将 .exe 伪装成 .pdf
        if (/[\u202A-\u202E\u2066-\u2069]/.test(rawName)) {
            console.warn('🚨 [Download Guard] 检测到 RTL 覆盖字符文件名 (视觉欺骗) 强制拦截:', rawName);
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

        // 🛡️ D1 修复 2：HTML Smuggling (Blob/Data URL 走私) 增强版检查
        const isLocalGeneration = rawUrl.startsWith('blob:') || rawUrl.startsWith('data:');
        if (isLocalGeneration) {
            // 针对 Blob/Data 下载，我们不再依赖 UUID 文件名，直接看 MIME 和后缀
            const safeLocalExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf', '.txt', '.csv', '.zip', '.mp4', '.mp3'];
            const isSafeExt = safeLocalExts.some(ext => name.endsWith(ext));
            const isSafeMime = item.mime && (
                item.mime.startsWith('image/') ||
                item.mime === 'application/pdf' ||
                item.mime === 'text/plain' ||
                item.mime === 'text/csv'
            );

            // 如果后缀和 MIME 都不在安全名单内，直接拦截！
            if (!isSafeExt && !isSafeMime) {
                console.warn('🚨 [Download Guard] 检测到 HTML Smuggling (Blob/Data URL 走私)，强制拦截:', rawUrl);
                suggest();
                chrome.downloads.cancel(item.id).catch(() => {});
                chrome.downloads.erase({ id: item.id }).catch(() => {});
                chrome.tabs.create({ url: chrome.runtime.getURL(`warning.html?type=download&reason=smuggling&filename=${encodeURIComponent(name)}&url=${encodeURIComponent(rawUrl)}`) });
                const dict = getDict();
                showDownloadNotification('danger', name,
                    dict.phish_download_smuggling_title || '🚨 Malicious Script Blocked',
                    (dict.phish_download_smuggling_desc || 'An inline payload disguised as an executable was blocked.').replace('{filename}', 'Obfuscated Payload')
                );
                return;
            }
        }

        // 2. 检查双扩展名 (如 invoice.pdf.exe)
        const doubleExtRegex = /\.(pdf|docx?|xlsx?|pptx?|jpg|jpeg|png|gif|txt|csv|zip|rar)\.(exe|scr|js|vbs|bat|cmd|lnk|hta|msi|jar|ps1)$/i;
        const isDoubleExt = doubleExtRegex.test(name);

        // 3. 检查高危可执行后缀
        const highRiskExts = ['.exe', '.msi', '.msix', '.appx', '.vbs', '.vbe', '.wsf', '.hta', '.lnk', '.scr', '.iso', '.img', '.vhd', '.chm', '.jar', '.ps1', '.bat', '.cmd', '.reg', '.apk'];
        const isHighRisk = highRiskExts.some(ext => name.endsWith(ext));

        if (!isDoubleExt && !isHighRisk) {
            suggest();
            return;
        }

        // 🛡️ N-4 修复：仅豁免官方更新域名，移除 github.com 等第三方豁免
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

        // 6. 处置逻辑
        if (isDoubleExt) {
            // 🛡️ 双扩展名：真拦截
            // 必须先调用 suggest()，使下载进入"进行中"状态，否则 cancel() 会报错 "Download must be in progress"
            suggest();
            chrome.downloads.cancel(item.id)
                .catch(() => { /* 静默忽略极速下载已完成等边界情况下的错误 */ })
                .finally(() => {
                    chrome.downloads.erase({ id: item.id }).catch(() => {});
                });
            const realUrl = item.finalUrl || item.url || '';
            const warningUrl = chrome.runtime.getURL(`warning.html?type=download&filename=${encodeURIComponent(name)}&url=${encodeURIComponent(realUrl)}`);
            chrome.tabs.create({ url: warningUrl });
            const dict = getDict();
            showDownloadNotification('danger', name, dict.phish_download_danger_title || '🚨 High-Risk Download Blocked', (dict.phish_download_danger_desc || 'A double extension file ({filename}) was detected.').replace('{filename}', name));
            return; // 阻断，不调用 suggest()
        } else if (isHighRisk) {
            // 普通高危后缀：弹窗警告，允许用户继续下载
            const dict = getDict();
            showDownloadNotification('warning', name, dict.phish_download_warn_title || '⚠️ Security Risk', (dict.phish_download_warn_desc || 'You are downloading an executable from an unknown source ({filename}).').replace('{filename}', name));
            suggest();
        }
    });
}
