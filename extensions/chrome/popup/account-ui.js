// ==========================================
// 📁 account-ui.js
// 职责：处理账户面板交互，并在加载时强制向云端同步最新数据
// ==========================================
import { getCurrentUser, logoutUser, fetchUserProfile } from '../src/authManager.js';

let profileFetchSeq = 0;

// 渲染已登录状态的视图
export function renderLoggedInView(user) {
    if (!user) return;
    const isPremium = user.tier === 'premium' || user.tier === 'family' || user.tier === 'pro' || user.tier === 'trial';
    
    document.getElementById('loggedInEmail').textContent = user.email;
    
    // 等级名称翻译
    let tierText = window.t('tier_free');
    if (user.tier === 'family') {
        tierText = window.t('tier_family_plan');
    } else if (user.tier === 'trial') {
        tierText = window.t('tier_trial_plan') || 'Pro Trial';
    } else if (user.tier === 'pro' || user.tier === 'premium') {
        tierText = window.t('tier_pro_plan');
    }
    
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
        devicesEl.textContent = `Family: ${user.ownerEmail}`; // Family 不需要翻译
        if (deviceLabel) deviceLabel.textContent = window.t('group_belong');
        devicesEl.style.color = "#58a6ff";
    } else if (user.tier === 'family') {
        devicesEl.textContent = window.t('tier_family');
        if (deviceLabel) deviceLabel.textContent = window.t('group_belong');
        devicesEl.style.color = "#58a6ff";
    } else {
        if (deviceLabel) deviceLabel.textContent = window.t('auth_devices');
        devicesEl.style.color = ""; 
        const limit = (user.tier === 'pro' || user.tier === 'premium' || user.tier === 'trial') ? 3 : 0;
        const current = user.deviceCount !== undefined ? user.deviceCount : (isPremium ? 1 : 0);
        
        if (limit > 0) devicesEl.textContent = `${current} / ${limit}`;
        else devicesEl.textContent = '- / -';
    }

    // 激活试用按钮
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

export function initAccountUI() {
    // 🌟 提取公共的跳转逻辑
    const openDashboardWithToken = async (e) => {
        if (e) e.preventDefault();
        try {
            const user = await getCurrentUser();
            const baseUrl = 'https://dewsecure.com/dashboard.html';
            if (user && user.token) {
                const url = new URL(baseUrl);
                url.searchParams.set('token', user.token);
                if (user.refreshToken) url.searchParams.set('refresh', user.refreshToken);
                chrome.tabs.create({ url: url.toString() });
            } else {
                chrome.tabs.create({ url: baseUrl });
            }
        } catch (err) {
            chrome.tabs.create({ url: 'https://dewsecure.com/dashboard.html' });
        }
    };

    const btnManage = document.getElementById('manageAccountBtn');
    const btnTrial = document.getElementById('activateTrialBtn');
    const btnLogout = document.getElementById('logoutBtn');
    const btnConfirmLogout = document.getElementById('confirmLogoutBtn');
    const btnCancelLogout = document.getElementById('cancelLogoutBtn');
    const confirmModal = document.getElementById('confirmModal');

    if (btnManage) {
        btnManage.onclick = openDashboardWithToken;
    }

    // 🌟 新增：试用按钮也跳转到 Dashboard
    if (btnTrial) {
        btnTrial.onclick = openDashboardWithToken;
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

    // 启动强制云端同步
    document.addEventListener('DOMContentLoaded', async () => {
        if (!document.getElementById('loggedInEmail')) return;
        
        const mySeq = ++profileFetchSeq;
        try {
            const freshUser = await fetchUserProfile();
            if (mySeq !== profileFetchSeq) return;
            if (freshUser) renderLoggedInView(freshUser);
        } catch (err) { console.error("❌ 同步失败:", err); }
    });
}

// 监听本地存储变化
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.dewsecure_user) {
        profileFetchSeq++;
        const newUser = changes.dewsecure_user.newValue;
        if (newUser) renderLoggedInView(newUser);
        else {
            const authModal = document.getElementById('authModal');
            if (authModal) authModal.querySelectorAll('.auth-step').forEach(el => el.classList.toggle('hidden', el.dataset.step !== 'email'));
            window.location.reload();
        }
    }
});
