// ==========================================
// 📱 设备上报 + Firefox 侧边栏适配
// ==========================================
import { getCurrentUser } from '../authManager.js';
import { reportDeviceSilently } from '../deviceManager.js';

export function initDevice() {
    // 启动强制设备上报
    (async () => {
        const user = await getCurrentUser();
        if (user && user.token) {
            await chrome.storage.local.remove('dewsecure_last_device_report');
            reportDeviceSilently(user.token).catch(console.warn);
        }
    })();

    // 🌟 Firefox 侧边栏自动打开逻辑（加了严格判断）
    if (typeof chrome !== 'undefined' && chrome.sidebarAction && chrome.action && chrome.action.onClicked) {
        chrome.action.onClicked.addListener(() => {
            if (chrome.sidebarAction.open) {
                chrome.sidebarAction.open();
            }
        });
    }
}
