// ==========================================
// 📁 auth-ui.js
// 职责：专门处理认证弹窗（登录/注册）的所有逻辑。
// 包含：发送 OTP、验证 OTP、重发倒计时（30秒）、Enter键支持、防刷爆与防卡死。
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

    // 🛡️ 防刷冷却倒计时（默认30秒）
    const startCooldown = (btn, originalText, seconds = 60) => {
        let count = seconds;
        btn.disabled = true;
        btn.textContent = `未收到？${count}s 后可重发`;
        const timer = setInterval(() => {
            count--;
            btn.textContent = `未收到？${count}s 后可重发`;
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
            if (emailHint) { emailHint.textContent = '请输入有效的邮箱地址'; emailHint.style.color = '#f85149'; emailHint.style.display = 'block'; }
            return;
        }

        btnSend.disabled = true;
        btnSend.textContent = '发送中...';
        if (emailHint) emailHint.style.display = 'none';

        try {
            const res = await sendOTP(email);
            if (res.ok) {
                document.getElementById('sentEmail').textContent = email;
                showAuthStep('otp');
                // 发送成功后，立刻给重发按钮加上 30 秒冷却
                if (btnResend) startCooldown(btnResend, '重新发送验证码', 60);
            } else {
                if (emailHint) { emailHint.textContent = res.error || '发送失败'; emailHint.style.color = '#f85149'; emailHint.style.display = 'block'; }
                btnSend.disabled = false;
                btnSend.textContent = '发送验证码';
            }
        } catch (e) {
            if (emailHint) { emailHint.textContent = '网络异常，请检查网络'; emailHint.style.color = '#f85149'; emailHint.style.display = 'block'; }
            btnSend.disabled = false;
            btnSend.textContent = '发送验证码';
        } finally {
            // 发送成功后主按钮进入长时间冷却（60秒），防止回退再发
            if (btnSend.textContent === '发送中...') {
                if (!btnSend.dataset.cooldown) startCooldown(btnSend, '发送验证码', 60);
            }
        }
    };

    // 2. 验证 OTP 逻辑
    const doVerifyOtp = async () => {
        if (btnVerify.disabled) return;
        const otp = otpInput.value.trim();
        
        if (otp.length !== 8) {
            if (otpHint) { otpHint.textContent = '请输入 8 位验证码'; otpHint.style.color = '#f85149'; otpHint.style.display = 'block'; }
            return;
        }

        btnVerify.disabled = true;
        btnVerify.textContent = '验证中...';
        if (otpHint) otpHint.style.display = 'none';

        try {
            const email = document.getElementById('sentEmail').textContent;
            const res = await verifyOTP(email, otp);

            if (res.ok) {
                const user = await getCurrentUser();
                showAuthStep('logged-in');
                renderLoggedInView(user);
                // 保持弹窗显示，让用户确认状态。主界面的刷新在用户关闭弹窗时触发。
            } else {
                if (otpHint) { otpHint.textContent = res.error || '验证失败，请检查验证码'; otpHint.style.color = '#f85149'; otpHint.style.display = 'block'; }
                btnVerify.disabled = false;
                btnVerify.textContent = '验证';
            }
        } catch (e) {
            if (otpHint) { otpHint.textContent = '网络异常，请稍后再试'; otpHint.style.color = '#f85149'; otpHint.style.display = 'block'; }
            btnVerify.disabled = false;
            btnVerify.textContent = '验证';
        }
    };

    // 3. 绑定点击事件
    if (btnSend) btnSend.onclick = doSendOtp;
    if (btnVerify) btnVerify.onclick = doVerifyOtp;
    if (btnBack) btnBack.onclick = () => showAuthStep('email');

    // 4. 绑定 Enter 键
    if (emailInput) {
        emailInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSendOtp(); } };
    }
    if (otpInput) {
        otpInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doVerifyOtp(); } };
    }

    // 5. 重发按钮（带防刷与错误捕获）
    if (btnResend) {
        btnResend.onclick = async () => {
            if (btnResend.disabled) return;
            
            const orig = '重新发送验证码';
            btnResend.disabled = true;
            btnResend.textContent = '发送中...';
            if (otpHint) otpHint.style.display = 'none';
            
            try {
                const email = document.getElementById('sentEmail').textContent;
                const res = await sendOTP(email);
                if (res.ok) {
                    if (otpHint) { otpHint.textContent = '✅ 验证码已重新发送'; otpHint.style.color = '#3fb950'; otpHint.style.display = 'block'; }
                    startCooldown(btnResend, orig, 60);
                } else {
                    // 🚨 核心修复：把 Supabase 的限流错误暴露出来
                    if (otpHint) { otpHint.textContent = res.error || '发送失败'; otpHint.style.color = '#f85149'; otpHint.style.display = 'block'; }
                    startCooldown(btnResend, orig, 60); // 失败也要冷却30秒，防止狂点
                }
            } catch (e) {
                if (otpHint) { otpHint.textContent = '网络异常'; otpHint.style.color = '#f85149'; otpHint.style.display = 'block'; }
                startCooldown(btnResend, orig, 60);
            }
        };
    }
}
