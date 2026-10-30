export function showDeviceLimitModal(t) {
    const existingModal = document.getElementById('deviceLimitModal');
    if (existingModal) return; // 已经存在就不重复弹出

    // 隐藏其他弹窗防遮挡
    ['authModal', 'settingsModal', 'pauseConfirmModal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
    });

    const trans = t || ((k) => k);
    const title = trans('limit_title') !== 'limit_title' ? trans('limit_title') : 'Device Limit Reached';
    const desc = trans('limit_desc') !== 'limit_desc' ? trans('limit_desc') : '您的设备数已达上限 (3/3)。请前往 Dashboard 解绑其他设备后重试。';
    const btnGo = trans('limit_btn_go') !== 'limit_btn_go' ? trans('limit_btn_go') : '去 Dashboard 解绑';
    const btnClose = trans('limit_btn_close') !== 'limit_btn_close' ? trans('limit_btn_close') : '关闭';

    const modalHTML = `
    <div id="deviceLimitModal" style="position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); backdrop-filter: blur(8px); pointer-events: auto;">
        <div style="background: #ffffff; border-radius: 16px; padding: 24px; width: 320px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); text-align: center; border: 1px solid #e0e0e0;">
            <div style="font-size: 40px; margin-bottom: 12px;">🚫</div>
            <h3 style="margin: 0 0 10px 0; color: #1c1c1e; font-size: 18px;">${title}</h3>
            <p style="margin: 0 0 20px 0; color: #3a3a3c; font-size: 13px; line-height: 1.4;">${desc}</p>
            <button id="btnGoDashboard" style="width: 100%; padding: 12px; margin-bottom: 10px; border: none; border-radius: 10px; background: #10b981; color: white; font-weight: 600; font-size: 14px; cursor: pointer;">${btnGo}</button>
            <button id="btnCloseLimitModal" style="width: 100%; padding: 12px; border: none; border-radius: 10px; background: #f1f1f1; color: #8b949e; font-weight: 600; font-size: 14px; cursor: pointer;">${btnClose}</button>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('deviceLimitModal');

    // 绑定关闭按钮
    document.getElementById('btnCloseLimitModal').onclick = async () => {
        if (modal) modal.remove();
        await chrome.storage.local.remove('dewsecure_device_limit_reached');
        if (window.syncUserState) window.syncUserState(); // 🌟 直接调用全局同步，而不是乱 import
    };

    // 绑定跳转按钮
    document.getElementById('btnGoDashboard').onclick = async () => {
        if (modal) modal.remove();
        await chrome.storage.local.remove('dewsecure_device_limit_reached');
        try {
            let url = 'https://dewsecure.com/dashboard.html';
            const { dewsecure_user: user } = await chrome.storage.local.get('dewsecure_user');
            if (user && user.token) {
                const u = new URL(url);
                u.searchParams.set('token', user.token);
                if (user.refreshToken) u.searchParams.set('refresh', user.refreshToken);
                url = u.toString();
            }
            chrome.tabs.create({ url });
        } catch (err) {
            chrome.tabs.create({ url: 'https://dewsecure.com/dashboard.html' });
        }
    };
}
