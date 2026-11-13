package com.dewsecure.android.policy

import android.content.Context
import android.util.Log
import java.security.KeyStore
import java.security.cert.X509Certificate

object CertificateChecker {
    private const val TAG = "CertificateChecker"

    /**
     * 检查系统中是否安装了 DewSecure 的 CA 证书
     */
    fun isDewSecureCaInstalled(context: Context): Boolean {
        try {
            val ks = KeyStore.getInstance("AndroidCAStore")
            ks.load(null, null)
            val aliases = ks.aliases()
            
            while (aliases.hasMoreElements()) {
                val alias = aliases.nextElement()
                // AndroidCAStore 中的别名通常以 "user:" 或 "system:" 开头
                val cert = ks.getCertificate(alias) as? X509Certificate ?: continue
                
                // 检查颁发者或主题是否包含 DewSecure
                val subject = cert.subjectDN.name
                val issuer = cert.issuerDN.name
                
                if (subject.contains("DewSecure", ignoreCase = true) || 
                    issuer.contains("DewSecure", ignoreCase = true)) {
                    Log.i(TAG, "✅ 找到 DewSecure CA 证书，别名: $alias")
                    return true
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ 检查证书失败", e)
        }
        Log.w(TAG, "⚠️ 未在系统中找到 DewSecure CA 证书")
        return false
    }
}
