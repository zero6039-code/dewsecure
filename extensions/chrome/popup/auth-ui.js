// ==========================================
// 📁 auth-ui.js
// 职责：专门处理认证弹窗（登录/注册）的所有逻辑。
// ==========================================

import { sendOTP, verifyOTP, getCurrentUser } from '../src/authManager.js';
import { renderLoggedInView } from './account-ui.js';

// 切换认证步骤（email -> otp -> logged-in）
export function showAuthStep(step) {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    
    modal.querySelectorAll('.auth-step').forEach((el) => {
        el.classList.toggle('hidden', el.dataset.step !== step);
    });

    if (step === 'otp') {
        const otpInput = document.getElementById('otpInput');
        if (otpInput) {
            setTimeout(() => otpInput.focus(), 100);
            otpInput.value = '';
            otpInput.classList.remove('error');
        }
    }
}

// 初始化认证交互
export function initAuthUI() {
    const emailInput = document.getElementById('authEmail');
    const otpInput = document.getElementById('otpInput');
    const btnSend = document.getElementById('sendOtpBtn');
    const btnVerify = document.getElementById('verifyOtpBtn');
    const btnResend = document.getElementById('resendOtpBtn');
    const btnBack = document.getElementById('backToEmailBtn');
    const emailHint = document.getElementById('emailHint');
    const otpHint = document.getElementById('otpHint');

    // 🛡️ 防刷冷却倒计时
    const startCooldown = (btn, originalText, seconds = 60) => {
        let count = seconds;
        btn.disabled = true;
        
        const tpl = window.t ? window.t('auth_resend_cooldown') : "未收到？{s}s 后可重发";
        btn.textContent = tpl.replace('{s}', count);

        const timer = setInterval(() => {
            count--;
            btn.textContent = tpl.replace('{s}', count);
            if (count <= 0) {
                clearInterval(timer);
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }, 1000);
    };

    // 1. 发送验证码逻辑（带防刷）
    const doSendOtp = async () => {
        if (btnSend.disabled) return;
        const email = emailInput.value.trim();
        
        if (!email || !email.includes('@')) {
            if (emailHint) { emailHint.textContent = window.t ? window.t('auth_invalid_email') : '请输入有效的邮箱地址'; emailHint.style.color = '#f85149'; emailHint.style.display = 'block'; }
            return;
        }

        btnSend.disabled = true;
        btnSend.textContent = '...';
        if (emailHint) emailHint.style.display = 'none';

        try {
            const res = await sendOTP(email);
            if (res.ok) {
                showAuthStep('otp');
                document.getElementById('sentEmail').textContent = email;
                startCooldown(btnResend, window.t ? window.t('auth_resend') : '重新发送验证码', 60);
            } else {
                // 🌟 核心优化：如果触发了限流，直接跳转到输入验证码界面！
                // 因为用户大概率在之前的 60 秒内已经收到了验证码。
                if (res.error && (res.error.includes('频繁') || res.error.includes('limit'))) {
                    // 🌟 严格按照逻辑：两边验证码独立，直接提示限流
                    if (emailHint) { 
                        emailHint.textContent = window.t ? window.t('auth_rate_limit') : '登录太频繁，请稍后重试。'; 
                        emailHint.style.color = '#f85149'; 
                        emailHint.style.display = 'block'; 
                    }
                    btnSend.disabled = false;
                    btnSend.textContent = window.t ? window.t('auth_send_otp') : '发送验证码';
                } else {
                    if (emailHint) { emailHint.textContent = res.error || '发送失败'; emailHint.style.color = '#f85149'; emailHint.style.display = 'block'; }
                    btnSend.disabled = false;
                    btnSend.textContent = window.t ? window.t('auth_send_otp') : '发送验证码';
                }
            }
        } catch (e) {
            if (emailHint) { emailHint.textContent = window.t ? window.t('auth_network_error') : '网络异常'; emailHint.style.color = '#f85149'; emailHint.style.display = 'block'; }
            btnSend.disabled = false;
            btnSend.textContent = window.t ? window.t('auth_send_otp') : '发送验证码';
        }
    };

    // 2. 验证 OTP 逻辑
    const doVerifyOtp = async () => {
        if (btnVerify.disabled) return;
        const otp = otpInput.value.trim();
        
        if (otp.length !== 8) {
            if (otpHint) { 
                otpHint.textContent = window.t ? window.t('auth_invalid_otp') : '请输入 8 位验证码'; 
                otpHint.style.color = '#f85149'; 
                otpHint.style.display = 'block'; 
            }
            return;
        }

        btnVerify.disabled = true;
        btnVerify.textContent = window.t ? window.t('auth_verifying') : '验证中...';
        if (otpHint) otpHint.style.display = 'none';

        try {
            const email = document.getElementById('sentEmail').textContent;
            const res = await verifyOTP(email, otp);

            if (res.ok) {
                // 等待全局同步完成
                if (typeof window.syncUserState === 'function') {
                    await window.syncUserState();
                }
                
                // 如果设备满了，syncUserState 会设置 _deviceLimitReached，此时绝不能渲染已登录界面
                if (!window._deviceLimitReached) {
                    const user = await getCurrentUser();
                    if (user) {
                        showAuthStep('logged-in');
                        renderLoggedInView(user);
                    }
                }
            } else {
                if (otpHint) { otpHint.textContent = res.error || '验证失败，请检查验证码'; otpHint.style.color = '#f85149'; otpHint.style.display = 'block'; }
                btnVerify.disabled = false;
                btnVerify.textContent = window.t ? window.t('auth_verify') : '验证';
            }
        } catch (e) {
            if (otpHint) { otpHint.textContent = window.t ? window.t('auth_network_error') : '网络异常，请稍后再试'; otpHint.style.color = '#f85149'; otpHint.style.display = 'block'; }
            btnVerify.disabled = false;
            btnVerify.textContent = window.t ? window.t('auth_verify') : '验证';
        }
    };

    // 3. 绑定点击事件
    if (btnSend) btnSend.onclick = doSendOtp;
    if (btnVerify) btnVerify.onclick = doVerifyOtp;
    if (btnBack) btnBack.onclick = () => showAuthStep('email');

    // 4. 绑定 Enter 键与自动提交
    if (emailInput) {
        emailInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSendOtp(); } };
    }
    if (otpInput) {
        otpInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doVerifyOtp(); } };
        
        // 🌟 高端体验：粘贴或输入满 8 位，自动过滤非数字并提交
        otpInput.oninput = (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8);
            if (e.target.value.length === 8 && !btnVerify.disabled) {
                setTimeout(() => doVerifyOtp(), 100);
            }
        };
    }

    // 5. 重发按钮
    if (btnResend) {
        btnResend.onclick = async () => {
            if (btnResend.disabled) return;
            
            const orig = window.t ? window.t('auth_resend') : '重新发送验证码';
            btnResend.disabled = true;
            btnResend.textContent = '...';
            
            try {
                const email = document.getElementById('sentEmail').textContent;
                const res = await sendOTP(email);
                if (res.ok) {
                    startCooldown(btnResend, orig, 60);
                } else {
                    alert(res.error || '发送失败');
                    btnResend.disabled = false;
                    btnResend.textContent = orig;
                }
            } catch (e) {
                btnResend.disabled = false;
                btnResend.textContent = orig;
            }
        };
    }
}
