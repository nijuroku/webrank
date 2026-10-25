package site.lamafia.beybladex;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {
    private static final String START_URL = "https://www.lamafia.site/";
    private static final String VERCEL_BACKUP_URL = "https://lamafia-kappa.vercel.app/";
    private static final int FILE_CHOOSER_REQUEST = 2041;
    private static final Set<String> APP_HOSTS = new HashSet<>(Arrays.asList(
            "www.lamafia.site",
            "lamafia.site",
            "lamafia-kappa.vercel.app"
    ));

    private WebView webView;
    private ProgressBar progressBar;
    private ValueCallback<Uri[]> fileChooserCallback;
    private boolean usingVercelFallback = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(13, 13, 26));
        window.setNavigationBarColor(Color.rgb(13, 13, 26));
        WindowCompat.setDecorFitsSystemWindows(window, false);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.rgb(0, 255, 136)));
        progressBar.setBackgroundColor(Color.TRANSPARENT);

        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                dp(3),
                Gravity.TOP
        );
        root.addView(progressBar, progressParams);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            webView.setPadding(0, bars.top, 0, bars.bottom);
            progressBar.setTranslationY(bars.top);
            return windowInsets;
        });
        WindowCompat.getInsetsController(window, root).setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(window, root).setAppearanceLightNavigationBars(false);
        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setLoadsImagesAutomatically(true);
        settings.setDefaultTextEncodingName("UTF-8");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new DownloadBridge(), "AndroidFileSaver");
        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppWebChromeClient());
        webView.setDownloadListener(new AppDownloadListener());

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private boolean isAppHost(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost();
        return host != null && APP_HOSTS.contains(host.toLowerCase(Locale.ROOT));
    }

    private boolean isPrimaryDomain(Uri uri) {
        if (uri == null || uri.getHost() == null) return false;
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        return "www.lamafia.site".equals(host) || "lamafia.site".equals(host);
    }

    private void useVercelBackup() {
        if (usingVercelFallback) return;
        usingVercelFallback = true;
        runOnUiThread(() -> {
            Toast.makeText(MainActivity.this, "Dominio principal no disponible. Abriendo respaldo de Vercel…", Toast.LENGTH_LONG).show();
            webView.loadUrl(VERCEL_BACKUP_URL);
        });
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAppHost(uri)) return false;
            if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "No se pudo abrir el enlace", Toast.LENGTH_SHORT).show();
                }
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            progressBar.setVisibility(View.GONE);
            CookieManager.getInstance().flush();
            installDownloadHandler();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) {
                progressBar.setVisibility(View.GONE);
                if (isPrimaryDomain(request.getUrl())) {
                    useVercelBackup();
                    return;
                }
                Toast.makeText(MainActivity.this, "No se pudo cargar el torneo. Comprueba tu conexión e inténtalo de nuevo.", Toast.LENGTH_LONG).show();
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            super.onReceivedHttpError(view, request, response);
            if (request.isForMainFrame() && response.getStatusCode() >= 400 && isPrimaryDomain(request.getUrl())) {
                useVercelBackup();
            }
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            Uri failingUrl = error == null ? null : Uri.parse(error.getUrl());
            if (isPrimaryDomain(failingUrl)) {
                useVercelBackup();
            } else {
                Toast.makeText(MainActivity.this, "No se pudo establecer una conexión segura con el torneo.", Toast.LENGTH_LONG).show();
            }
        }
    }

    private final class AppWebChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progressBar.setProgress(newProgress);
            progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
            } catch (Exception exception) {
                fileChooserCallback = null;
                callback.onReceiveValue(null);
                Toast.makeText(MainActivity.this, "No se pudo abrir el selector de archivos", Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }
    }

    private final class AppDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
            Uri uri = Uri.parse(url);
            if (isAppHost(uri) || "blob".equalsIgnoreCase(uri.getScheme())) {
                Toast.makeText(MainActivity.this, "Preparando descarga…", Toast.LENGTH_SHORT).show();
                return;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                Toast.makeText(MainActivity.this, "No se pudo abrir la descarga", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void installDownloadHandler() {
        String bridgeScript = "(function(){"
                + "if(window.__lamafiaDownloadHandler)return;window.__lamafiaDownloadHandler=true;"
                + "document.addEventListener('click',function(event){"
                + "var link=event.target&&event.target.closest?event.target.closest('a[download]'):null;"
                + "if(!link)return;event.preventDefault();event.stopPropagation();"
                + "var name=link.getAttribute('download')||'descarga';"
                + "fetch(link.href).then(function(response){return response.blob()}).then(function(blob){"
                + "var reader=new FileReader();reader.onloadend=function(){"
                + "window.AndroidFileSaver.saveDataUrl(name,blob.type||'application/octet-stream',reader.result);"
                + "};reader.readAsDataURL(blob);"
                + "}).catch(function(){alert('No se pudo preparar el archivo para descargar.');});"
                + "},true);})();";
        webView.evaluateJavascript(bridgeScript, null);
    }

    private final class DownloadBridge {
        @JavascriptInterface
        public void saveDataUrl(String fileName, String mimeType, String dataUrl) {
            try {
                int comma = dataUrl.indexOf(',');
                if (comma < 0) throw new IllegalArgumentException("Archivo inválido");
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                String safeName = fileName == null ? "descarga" : fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
                String safeMime = mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType;

                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri fileUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (fileUri == null) throw new IllegalStateException("No se pudo crear el archivo");

                try (OutputStream output = getContentResolver().openOutputStream(fileUri)) {
                    if (output == null) throw new IllegalStateException("No se pudo guardar el archivo");
                    output.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(fileUri, values, null, null);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Archivo guardado en Descargas", Toast.LENGTH_LONG).show());
            } catch (Exception exception) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "No se pudo guardar el archivo", Toast.LENGTH_LONG).show());
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileChooserCallback.onReceiveValue(results);
            fileChooserCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidFileSaver");
            webView.destroy();
        }
        super.onDestroy();
    }
}
