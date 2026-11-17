package com.dewsecure.android

import android.app.Application
import com.dewsecure.android.policy.EngineBridge

class DewSecureApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // A-09: 进程级唯一初始化点，baseDir 恒为 filesDir
        EngineBridge.init(this, aiEnabled = true)
    }
}
