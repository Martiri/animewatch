package it.martiri.animewatch

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
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val currentVersionName = "1.0.1"
    private val repoReleasesApi = "https://api.github.com/repos/Martiri/animewatch/releases/latest"

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

        // 3. Inizializzazione WebView
        webView = WebView(this).apply {
            id = View.generateViewId()
            setBackgroundColor(0xFF0B0F17.toInt()) // OLED Dark #0b0f17
        }
        setContentView(webView)

        // 4. Configurazione WebViewAssetLoader (Servizio asset locali sicuri)
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
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.webViewClient = object : WebViewClient() {
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
                val url = request.url.toString()

                // Navigazione interna nell'app
                if (url.startsWith("https://appassets.androidplatform.net/")) {
                    return false
                }

                // Android Intent per app native (Crunchyroll, Netflix, Disney+, Prime Video, ecc.)
                if (url.startsWith("intent://")) {
                    try {
                        val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                        if (intent != null) {
                            intent.addCategory(Intent.CATEGORY_BROWSABLE)
                            intent.component = null
                            intent.selector = null
                            if (intent.resolveActivity(packageManager) != null) {
                                startActivity(intent)
                                return true
                            }
                            // Fallback se l'app non è installata
                            val fallbackUrl = intent.getStringExtra("browser_fallback_url")
                            if (!fallbackUrl.isNullOrEmpty()) {
                                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(fallbackUrl)))
                                return true
                            }
                        }
                    } catch (_: Exception) {}
                    return true
                }

                // Link esterni / Store / Streaming -> Apertura nel browser o app nativa
                try {
                    val externalIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(externalIntent)
                } catch (_: Exception) {}
                return true
            }
        }

        // 5. Gestione Tasto Indietro / Gesture di navigazione
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Notifica l'app web per chiudere eventuali modali aperte prima di navigare
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

        // 6. Carica l'applicazione dagli asset locali bundled
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")

        // 7. Controllo Aggiornamenti Discreto (Zero REQUEST_INSTALL_PACKAGES, 100% Play Protect Clean)
        checkForAppUpdates()
    }

    private fun checkForAppUpdates() {
        thread {
            try {
                val url = URL(repoReleasesApi)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.setRequestProperty("User-Agent", "AnimeWatch-App/$currentVersionName")
                conn.connectTimeout = 4000
                conn.readTimeout = 4000

                if (conn.responseCode == 200) {
                    val response = conn.inputStream.bufferedReader().use { it.readText() }
                    val json = JSONObject(response)
                    val latestTag = json.optString("tag_name", "").replace("v", "").trim()
                    val htmlUrl = json.optString("html_url", "")

                    if (isNewerVersion(currentVersionName, latestTag) && htmlUrl.isNotEmpty()) {
                        runOnUiThread {
                            showUpdateDialog(latestTag, htmlUrl)
                        }
                    }
                }
            } catch (_: Exception) {}
        }
    }

    private fun isNewerVersion(current: String, latest: String): Boolean {
        if (latest.isEmpty()) return false
        val curParts = current.split(".").mapNotNull { it.toIntOrNull() }
        val latParts = latest.split(".").mapNotNull { it.toIntOrNull() }
        val maxLen = maxOf(curParts.size, latParts.size)
        for (i in 0 until maxLen) {
            val c = curParts.getOrElse(i) { 0 }
            val l = latParts.getOrElse(i) { 0 }
            if (l > c) return true
            if (l < c) return false
        }
        return false
    }

    private fun showUpdateDialog(newVersion: String, downloadUrl: String) {
        if (isFinishing || isDestroyed) return
        AlertDialog.Builder(this)
            .setTitle("Nuovo Aggiornamento Disponibile")
            .setMessage("È disponibile la versione v$newVersion di AnimeWatch. Vuoi scaricare l'aggiornamento?")
            .setPositiveButton("Scarica Aggiornamento") { _, _ ->
                try {
                    val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl))
                    startActivity(browserIntent)
                } catch (_: Exception) {}
            }
            .setNegativeButton("Più tardi", null)
            .show()
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
