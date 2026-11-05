package it.franco.animewatch

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. Edge-to-Edge display per Xiaomi HyperOS (POCO F7)
        enableEdgeToEdge()

        // 2. Lock 120Hz Hardware per Xiaomi POCO F7 (AMOLED 120Hz)
        try {
            val wm = windowManager
            val curDisplay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                display
            } else {
                @Suppress("DEPRECATION")
                wm.defaultDisplay
            }
            val modes = curDisplay?.supportedModes ?: emptyArray()
            val mode120 = modes.firstOrNull { it.refreshRate >= 119.0f }
            if (mode120 != null) {
                val lp = window.attributes
                lp.preferredDisplayModeId = mode120.modeId
                window.attributes = lp
            }
        } catch (_: Exception) {}

        // 3. Safe Browsing
        if (WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
            WebViewCompat.startSafeBrowsing(this) { _ -> }
        }

        // 4. Inizializzazione WebView sicura
        webView = WebView(this).apply {
            id = View.generateViewId()
            setBackgroundColor(0xFF0B0F17.toInt()) // OLED Dark #0b0f17
        }
        setContentView(webView)

        // 5. Configurazione WebViewAssetLoader
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        // 6. WebViewClient con Intent Handling ultra-sicuro
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url
                val scheme = uri.scheme?.lowercase() ?: return true

                // Risorse interne dell'applicazione
                if (scheme == "https" && uri.host == "appassets.androidplatform.net") {
                    return false
                }

                // Apertura sicura di link esterni solo se HTTP o HTTPS
                if (scheme == "https" || scheme == "http") {
                    try {
                        val browserIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                            addCategory(Intent.CATEGORY_BROWSABLE)
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK
                        }
                        startActivity(browserIntent)
                    } catch (_: Exception) {}
                    return true
                }

                return true
            }
        }

        // 7. Gestione Tasto Indietro / Gesture di navigazione
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    """
                    (function() {
                        const animeModal = document.getElementById('anime-detail-modal');
                        if (animeModal && !animeModal.classList.contains('hidden')) {
                            const closeBtn = document.getElementById('btn-close-modal');
                            if (closeBtn) closeBtn.click();
                            return true;
                        }
                        const pinModal = document.getElementById('privacy-pin-modal');
                        if (pinModal && !pinModal.classList.contains('hidden')) {
                            const closeBtn = document.getElementById('btn-close-pin-modal');
                            if (closeBtn) closeBtn.click();
                            return true;
                        }
                        return false;
                    })();
                    """.trimIndent()
                ) { result ->
                    val modalWasOpen = result == "true"
                    if (!modalWasOpen) {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                }
            }
        })

        // 8. Carica l'applicazione dagli asset locali bundled
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        webView.destroy()
    }
}
