// 🔒 S-06 修复：限制 content script 读取 storage.local，保护 Token 安全
if (chrome.storage && chrome.storage.local && chrome.storage.local.setAccessLevel) {
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(e => {
        console.warn('⚠️ 设置 storage 访问级别失败:', e);
    });
}

// 🌟 动态适配 Chrome 与 Edge 的 Side Panel
if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);
}

// ==========================================
// 📦 模块导入
// ==========================================
// 原地使用的核心模块（未搬走）
import { initSettings, getSettings, SETTINGS_KEY } from './background/settings.js';
import { updateDNRRulesets } from './background/messageHandler.js';
import { initSecurityListeners } from './background/security.js';
import { initStatsListener } from './background/stats.js';
import { restoreSessionRules } from './background/dnr.js';
import { initThreatFilter } from './background/threatIntel.js';
import { initIntelReporter } from './background/intelReporter.js';

// 拆分出的初始化模块
import { initMessaging } from './background/messaging.js';
import { initNavigation } from './background/navigation.js';
import { checkAndUpdatePhishModel } from './background/phishModelManager.js';
import { initDownloads } from './background/downloads.js';
import { initDevice } from './background/device.js';
import { initSchedules } from './background/schedules.js';
import { bootstrapDNR } from './background/dnr-bootstrap.js';
import { loadBgI18n } from './background/i18n.js';

// ==========================================
// 🚀 顶层初始化
// ==========================================
initSettings().then(async () => {
    // 🛡️ 修复：冷启动时同步 DNR 规则状态，防止重启浏览器后规则又默认开启
    const s = await getSettings();
    updateDNRRulesets(s.dnrEnabled, s.blockTrackers);
});
chrome.action.setBadgeText({ text: '' });
initSecurityListeners();
initStatsListener();
restoreSessionRules();
initThreatFilter(); // 🚀 启动时从 IndexedDB 恢复过滤器
initIntelReporter(); // 🚀 启动静默情报上报服务

// 拆分模块初始化
initMessaging();   // 内部消息 + 外部消息路由
initNavigation();  // tabs.onUpdated AI 检测 + webNavigation 钓鱼拦截
initDownloads();   // 下载守卫
initDevice();      // 设备上报 + Firefox 侧边栏
initSchedules();   // 威胁情报 + 模型更新定时任务
bootstrapDNR();
checkAndUpdatePhishModel();    // DNR 规则（官方豁免 + 挖矿 + 隐私）
loadBgI18n();      // 后台多语言引擎
