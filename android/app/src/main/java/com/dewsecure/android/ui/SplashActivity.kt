package com.dewsecure.android.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import androidx.appcompat.app.AppCompatActivity
import com.dewsecure.android.BuildConfig
import com.dewsecure.android.R

@SuppressLint("CustomSplashScreen")
class SplashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // 🌟 抛弃官方 installSplashScreen()，直接展示我们自己的绝美布局
        setContentView(R.layout.activity_splash)

        // 防破解校验
        if (!BuildConfig.DEBUG) {
            checkSignature()
        }

        // 荧光扫光动画
        val logo = findViewById<com.dewsecure.android.ui.view.ShimmerImageView>(R.id.iv_splash_logo)
        logo.startShimmer()

        // 延迟跳转
        Handler(Looper.getMainLooper()).postDelayed({
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            // 无缝衔接
            overridePendingTransition(0, 0)
        }, 2000)
    }


    private fun checkSignature() {
        val expectedSha256 = "466148368e4ac99e726c4cfdbef150a88df78370c5a846b14c9ab017ff22761c"
        try {
            val pm = packageManager
            val packageInfo = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                pm.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES)
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNATURES)
            }
            
            val signatures = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                packageInfo.signingInfo?.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                packageInfo.signatures
            }
            
            if (signatures.isNullOrEmpty()) {
                killApp()
                return
            }

            val md = java.security.MessageDigest.getInstance("SHA-256")
            val publicKey = md.digest(signatures[0].toByteArray())
            val actualSha256 = publicKey.joinToString("") { "%02x".format(it) }
            
            if (actualSha256 != expectedSha256) {
                killApp()
            }
        } catch (e: Exception) {
            killApp()
        }
    }
    
    private fun killApp() {
        Log.e("Security", "🚨 签名校验失败，检测到二次打包！App 即将退出。")
        android.os.Process.killProcess(android.os.Process.myPid())
        System.exit(0)
    }
}
