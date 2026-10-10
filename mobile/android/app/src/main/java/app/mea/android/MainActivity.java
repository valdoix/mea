package app.mea.android;

import android.app.DownloadManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView web = getBridge().getWebView();
        // Book, library and memory exports are plain links on Mea; hand them to Android's downloader
        // with this app's paired-device cookie so they land in Downloads.
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            if (!url.startsWith("https://")) {
                Toast.makeText(this, "This file can't be saved from the app.", Toast.LENGTH_SHORT).show();
                return;
            }
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url))
                .setMimeType(mimeType)
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url))
                .addRequestHeader("User-Agent", userAgent)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm != null) {
                dm.enqueue(req);
                Toast.makeText(this, "Saving " + name + " to Downloads", Toast.LENGTH_SHORT).show();
            }
        });
    }
}
