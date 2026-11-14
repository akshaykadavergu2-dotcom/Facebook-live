package com.livecast.capture

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import com.livecast.capture.databinding.ActivitySplashIntroBinding

/**
 * Broadcast opening intro screen (~3.5s) with Skip Intro button and smart cooldown
 * so deep links and quick task switches go straight to the Studio Control Room.
 */
class SplashIntroActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_FORCE_PLAY = "extra_force_play"
    }

    private lateinit var binding: ActivitySplashIntroBinding
    private var navigated = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val isDeepLink = intent?.data != null
        val forcePlay = intent?.getBooleanExtra(EXTRA_FORCE_PLAY, false) == true
        val store = SecureCredentialStore(this)

        if (!forcePlay && (isDeepLink || !store.shouldShowSplashIntro())) {
            forwardToMain()
            return
        }

        binding = ActivitySplashIntroBinding.inflate(layoutInflater)
        setContentView(binding.root)
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            )

        store.markSplashIntroShown()

        binding.btnSkipIntro.setOnClickListener {
            binding.splashIntroView.cancelAnimation()
            forwardToMain()
        }

        binding.splashIntroView.startAnimation(durationMs = 3500L) {
            forwardToMain()
        }
    }

    private fun forwardToMain() {
        if (navigated || isFinishing) return
        navigated = true

        val target = Intent(this, MainActivity::class.java).apply {
            action = intent?.action
            data = intent?.data
            intent?.extras?.let { putExtras(it) }
            addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
        }
        startActivity(target)
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }
}
