// ==========================================
// 📁 account-ui.js
// 职责：处理账户面板交互，并在加载时强制向云端同步最新数据
// ==========================================
import { getCurrentUser, logoutUser, fetchUserProfile } from '../src/authManager.js';

// 请求序号守卫，防止旧请求覆盖新数据
let profileFetchSeq = 0;

// 渲染已登录状态的视图
export function renderLoggedInView(user) {
    if (!user) return;
    const isPremium = user.tier === 'premium' || user.tier === 'family' || user.tier === 'pro';
    
    document.getElementById('loggedInEmail').textContent = user.email;
    
    // 精准显示等级名称
    let tierText = '免费版';
    if (user.tier === 'family') tierText = '👨‍👩‍👧‍👦 家庭版 (Family)';
    else if (user.tier === 'pro' || user.tier === 'premium') tierText = '⭐ 高级版 (Pro)';
    
    document.getElementById('accountTier').textContent = tierText;
    document.getElementById('accountTier').classList.toggle('free', !isPremium);
    
    // 处理到期时间显示
    let expiryText = '—';
    if (isPremium && user.expiresAt) {
        const d = new Date(user.expiresAt);
        expiryText = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    document.getElementById('accountExpiry').textContent = expiryText;

    // 设备数与家庭组邮箱展示
    const devicesEl = document.getElementById('accountDevices');
    const deviceLabel = devicesEl?.previousElementSibling;
    
    if (user.tier === 'family' && user.ownerEmail) {
        // 家庭组子账号显示
        devicesEl.textContent = `家庭组：${user.ownerEmail}`;
        if (deviceLabel) deviceLabel.textContent = "所属";
        devicesEl.style.color = "#58a6ff";
    } else if (user.tier === 'family') {
        // 家庭组兜底（避免因网络抖动缺失邮箱直接回退旧状态）
        devicesEl.textContent = `家庭版权益`;
        if (deviceLabel) deviceLabel.textContent = "所属";
        devicesEl.style.color = "#58a6ff";
    } else {
        // 主账号或 Pro 显示
        if (deviceLabel) deviceLabel.textContent = "设备";
        devicesEl.style.color = ""; 
        const limit = user.tier === 'pro' || user.tier === 'premium' ? 3 : 0;
        const current = user.deviceCount !== undefined ? user.deviceCount : (isPremium ? 1 : 0);
        
        if (limit > 0) {
            devicesEl.textContent = `设备 ${current} / ${limit}`;
        } else {
            devicesEl.textContent = '- / -';
        }
    }

    const btnTrial = document.getElementById('activateTrialBtn');
    if (btnTrial) {
        if (isPremium || user.hasUsedTrial) {
            btnTrial.classList.add('hidden');
            btnTrial.style.display = 'none'; 
        } else {
            btnTrial.classList.remove('hidden');
            btnTrial.style.display = 'block';
        }
    }
}

// 初始化账户面板的所有事件
export function initAccountUI() {
    const btnManage = document.getElementById('manageAccountBtn');
    const btnLogout = document.getElementById('logoutBtn');
    const btnConfirmLogout = document.getElementById('confirmLogoutBtn');
    const btnCancelLogout = document.getElementById('cancelLogoutBtn');
    const confirmModal = document.getElementById('confirmModal');

    if (btnManage) {
        btnManage.onclick = async (e) => {
            e.preventDefault();
            try {
                const user = await getCurrentUser();
                const baseUrl = 'https://dewsecure.com/dashboard.html';
                if (user && user.token) {
                    const url = new URL(baseUrl);
                    url.searchParams.set('token', user.token);
                    if (user.refreshToken) {
                        url.searchParams.set('refresh', user.refreshToken);
                    }
                    chrome.tabs.create({ url: url.toString() });
                } else {
                    chrome.tabs.create({ url: baseUrl });
                }
            } catch (err) {
                chrome.tabs.create({ url: 'https://dewsecure.com/dashboard.html' });
            }
        };
    }

    if (btnLogout && confirmModal) {
        btnLogout.onclick = (e) => { e.preventDefault(); confirmModal.classList.remove('hidden'); };
    }

    if (btnConfirmLogout) {
        btnConfirmLogout.onclick = async () => {
            await logoutUser();
            window.location.reload();
        };
    }

    if (btnCancelLogout && confirmModal) {
        btnCancelLogout.onclick = () => { confirmModal.classList.add('hidden'); };
    }

    // 🚨 终极同步触发：每次打开插件，向云端请求一次最新数据
    document.addEventListener('DOMContentLoaded', async () => {
        if (!document.getElementById('loggedInEmail')) return;
        
        const mySeq = ++profileFetchSeq;
        console.log("🔄 启动强制云端同步...");
        try {
            const freshUser = await fetchUserProfile();
            // 如果期间有更新的请求或存储变更触发，直接丢弃本次结果
            if (mySeq !== profileFetchSeq) {
                console.log("⏭️ 丢弃过期的 profile 响应");
                return;
            }
            if (freshUser) {
                console.log("✅ 同步成功，当前 Tier:", freshUser.tier);
                renderLoggedInView(freshUser);
            }
        } catch (err) {
            console.error("❌ 同步失败:", err);
        }
    });
}

// 监听本地存储变化，实现实时刷新 UI
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.dewsecure_user) {
        // 使正在进行的任何 fetchUserProfile 结果失效
        profileFetchSeq++;
        
        console.log("🔄 检测到云端状态更新，刷新插件 UI...");
        const newUser = changes.dewsecure_user.newValue;
        if (newUser) {
            renderLoggedInView(newUser);
        } else {
            const authModal = document.getElementById('authModal');
            if (authModal) {
                authModal.querySelectorAll('.auth-step').forEach(el => {
                    el.classList.toggle('hidden', el.dataset.step !== 'email');
                });
            }
            window.location.reload();
        }
    }
});
