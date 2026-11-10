// ==========================================
// 💬 消息分发：onMessage（内部）+ onMessageExternal（外部）
// C1 修复：消息分发策略表
// ==========================================
import { runAICheck } from './ai.js';
import { handleMessage } from './messageHandler.js';
import { forceDownloadUrls } from './state.js';
import { saveExternalAuth, logoutUser, getCurrentUser } from '../authManager.js';
import { updateThreatIntel } from './threatIntel.js';
import { checkAndUpdateModel } from '../modelManager.js';
import { reportDeviceSilently } from '../deviceManager.js';

const MESSAGE_POLICY = {
    'THIRD_PARTY_HOSTS': ['contentScript', 'extensionPage'],
    'CHECK_URL_AI': ['contentScript', 'extensionPage'],
    'DOM_AD_HIDDEN': ['contentScript', 'extensionPage'],
    'GET_SETTINGS': ['contentScript', 'extensionPage'],
    'MODEL_UPDATED': ['extensionPage'],
    'FORCE_DOWNLOAD': ['extensionPage'],
    'AUTH_STATE_CHANGED': ['extensionPage'],
    'FETCH_IMAGE_FOR_QR': ['contentScript', 'extensionPage'],
    // 🛡️ 显式声明核心管理消息，防止策略误判
    'REMOVE_TEMP_WHITELIST': ['extensionPage'],
    'ADD_TEMP_WHITELIST': ['extensionPage'],
    'GET_STATS': ['extensionPage'],
    'GET_LOGS': ['extensionPage'],
    'REPORT_FEEDBACK': ['extensionPage'],
    'UPDATE_SETTING_KEY': ['extensionPage'],
    'UPDATE_SETTINGS': ['extensionPage'],
    'ADD_WHITELIST': ['extensionPage'],
    'REMOVE_WHITELIST': ['extensionPage']
};

function isExtensionPage(sender) {
    if (!sender) return false;
    // 允许来自 Service Worker 控制台自身的消息（没有 url）
    if (sender.id === chrome.runtime.id && !sender.url) return true;
    const extUrl = chrome.runtime.getURL('');
    return !!(sender.url && sender.url.startsWith(extUrl));
}

function isContentScript(sender) {
    if (!sender) return false;
    return sender.id === chrome.runtime.id && !isExtensionPage(sender);
}

// 🔒 S-01: 外部消息来源白名单（生产域名）
const ALLOWED_EXTERNAL_ORIGINS = new Set([
    'https://dewsecure.com',
    'https://www.dewsecure.com'
]);

function isTrustedExternalSender(sender) {
    if (!sender) return false;
    if (typeof sender.origin === 'string' && sender.origin) {
        return ALLOWED_EXTERNAL_ORIGINS.has(sender.origin);
    }
    if (typeof sender.url === 'string' && sender.url) {
        try { return ALLOWED_EXTERNAL_ORIGINS.has(new URL(sender.url).origin); }
        catch { return false; }
    }
    return false;
}

export function initMessaging() {
    // 🚀 性能优化：合并消息分发，消除多个监听器竞争和无效的 return true
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // 🛡️ C1 修复：统一前置策略校验
        const allowedSenders = MESSAGE_POLICY[message.type];
        if (allowedSenders) {
            const senderType = isExtensionPage(sender) ? 'extensionPage' : (isContentScript(sender) ? 'contentScript' : 'unknown');
            if (!allowedSenders.includes(senderType)) {
                console.warn(`❌ [拦截] ${message.type} 拒绝来自 ${senderType} 的调用`);
                sendResponse({ error: 'Unauthorized sender for this message type' });
                return false;
            }
        } else {
            // 未在策略表中的消息，默认只允许扩展内部页面（如 GET_LOGS, UPDATE_SETTINGS）
            if (!isExtensionPage(sender)) {
                console.warn(`❌ [拦截] 未授权消息类型 ${message.type} 拒绝来自非扩展页面的调用`);
                sendResponse({ error: 'Privileged sender required' });
                return false;
            }
        }

        switch (message.type) {
            // --- 1. AI 异步处理 ---
            case 'FETCH_IMAGE_FOR_QR':
            (async () => {
                try {
                    const res = await fetch(message.url);
                    const blob = await res.blob();
                    const buffer = await blob.arrayBuffer();
                    
                    // 🛡️ 核心修复：Service Worker 中无 FileReader，使用 btoa 手动编码
                    const bytes = new Uint8Array(buffer);
                    let binary = '';
                    const len = bytes.byteLength;
                    for (let i = 0; i < len; i++) {
                        binary += String.fromCharCode(bytes[i]);
                    }
                    const base64 = btoa(binary);
                    const dataUrl = `data:${blob.type || 'image/png'};base64,${base64}`;
                    
                    sendResponse({ ok: true, dataUrl });
                } catch (e) {
                    console.warn('❌ [DewSecure] 后台代理下载图片失败:', e);
                    sendResponse({ ok: false, error: e.message });
                }
            })();
            return true; // 异步保持通道开启

        case 'THIRD_PARTY_HOSTS':
                if (!sender.tab) return false;
                chrome.storage.local.get('dewsecure_settings').then(res => {
                    const settings = res.dewsecure_settings || {};
                    if (settings.aiFourEnabled === false || settings.aiEnabled === false) {
                        sendResponse({ ok: true });
                        return;
                    }
                    import('./ai.js').then(({ runAICheck, recordHostRef }) => {
                        for (const host of message.hosts) {
                            recordHostRef(host); // 📊 记录跨站引用次数
                            runAICheck(host, sender.tab.id, true);
                        }
                        sendResponse({ ok: true });
                    }).catch(() => sendResponse({ ok: false }));
                });
                return true; // 异步，保持信道

            case 'CHECK_URL_AI':
                runAICheck(message.url, sender?.tab?.id);
                sendResponse({ ok: true });
                return false; // 同步结束，无需 hold

            // --- 2. 登录/模型状态同步 ---
            case 'MODEL_UPDATED':
                import('./ai.js').then(m => m.invalidateAIModelCache()).catch(() => {});
                sendResponse({ ok: true });
                return false;

            case 'FORCE_DOWNLOAD':
                // 🛡️ C1 修复：绝对不允许直接添加，必须匹配之前的拦截记录（一次性令牌）
                if (message.url && forceDownloadUrls.has(message.url)) {
                    forceDownloadUrls.delete(message.url); // 用后即焚
                    chrome.downloads.download({
                        url: message.url,
                        filename: message.filename,
                        conflictAction: 'uniquify'
                    }).catch(e => {
                        console.warn('[DewSecure] 强制下载失败:', e);
                    });
                    sendResponse({ ok: true });
                } else {
                    console.warn('❌ [Security] 拦截越权下载请求，缺少有效令牌:', message.url);
                    sendResponse({ ok: false, error: 'Invalid download token' });
                }
                return false;

            case 'AUTH_STATE_CHANGED':
                setTimeout(updateThreatIntel, 1000);
                checkAndUpdateModel().catch(console.warn);
                (async () => {
                    const user = await getCurrentUser();
                    if (user && user.token) reportDeviceSilently(user.token);
                })().catch(e => console.warn(e));
                sendResponse({ ok: true });
                return false;

            // --- 3. 其余核心业务全部交由 handleMessage 处理 ---
            default:
                handleMessage(message, sender).then(sendResponse).catch((e) => {
                    console.error('❌ [handleMessage 异常]', e);
                    sendResponse({ ok: false, error: e?.message || String(e) });
                });
                return true; // handleMessage 是异步 Promise
        }
    });

    // 外部通信
    chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
        console.log('🚨 [外部请求] 收到:', message.type, '来源:', sender?.origin || sender?.url);
        if (!isTrustedExternalSender(sender)) {
            console.warn('❌ [拦截] 来源不合法，已阻断！');
            return false;
        }
        if (message.type === 'SYNC_AUTH') {
            // 🛡️ L-3 修复：确保 payload 存在且包含合法的 token
            if (!message.payload || typeof message.payload.token !== 'string') {
                console.warn('❌ [拦截] 非法 SYNC_AUTH 载荷');
                return false;
            }
            saveExternalAuth(message.payload).then(res => sendResponse({ ok: res.ok }));
            return true;
        }
        if (message.type === 'LOGOUT') {
            logoutUser().then(() => sendResponse({ ok: true }));
            return true;
        }
        // 🌟 接收网页端的设备解绑通知，立刻广播给侧边栏去刷新并重新抢占坑位
        if (message.type === 'REFRESH_DEVICES') {
            chrome.runtime.sendMessage({ type: 'AUTH_STATE_CHANGED' }).catch(() => {});
            // 强制再次上报当前设备（此时如果网页端腾出了空位，这里就能插进去了）
            (async () => {
                const user = await getCurrentUser();
                if (user && user.token) {
                    reportDeviceSilently(user.token, true);
                }
            })().catch(() => {});
            sendResponse({ ok: true });
            return true;
        }
    });
}
