// ==========================================
// 📁 account-ui.js
// 职责：处理账户面板交互，并在加载时强制向云端同步最新数据
// ==========================================
import { getCurrentUser, logoutUser, fetchUserProfile } from '../src/authManager.js';

// 渲染已登录状态的视图
export function renderLoggedInView(user) {
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
    document.getElementById('accountDevices').textContent = isPremium ? '1 / 3' : '- / -';

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
                    // 如果有 refreshToken，一并带上
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
        
        console.log("🔄 启动强制云端同步...");
        try {
            const freshUser = await fetchUserProfile();
            if (freshUser) {
                console.log("✅ 同步成功，当前 Tier:", freshUser.tier);
                // 强制重绘 UI
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
        console.log("🔄 检测到云端状态更新，刷新插件 UI...");
        const newUser = changes.dewsecure_user.newValue;
        if (newUser) {
            renderLoggedInView(newUser);
        } else {
            // 登出状态
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
