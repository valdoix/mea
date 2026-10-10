package app.mea.android;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

public class MainActivity extends BridgeActivity {
    /**
     * L7: the app stays on the one Mea address you set up; every other site opens in the browser,
     * outside the app. Only the app's own setup page (its bundled index.html) can set that address.
     */
    @CapacitorPlugin(name = "MeaNavigation")
    public static class NavigationGuard extends Plugin {
        private static String originOf(Uri u) {
            int port = u.getPort();
            return u.getScheme() + "://" + u.getHost() + (port == -1 ? "" : ":" + port);
        }

        @Override
        public Boolean shouldOverrideLoad(Uri url) {
            String scheme = url.getScheme();
            if (url.getHost() == null || !("https".equals(scheme) || "http".equals(scheme))) return null;
            String appHost = Uri.parse(getBridge().getAppUrl()).getHost();
            // The setup page itself (also reached from Mea's "Change address"): Capacitor's own rules.
            if (url.getHost().equals(appHost)) return null;
            SharedPreferences prefs = getContext().getSharedPreferences("mea", Context.MODE_PRIVATE);
            WebView web = getBridge().getWebView();
            String current = web != null ? web.getUrl() : null;
            Uri here = current != null ? Uri.parse(current) : null;
            if ("https".equals(scheme) && (here == null || appHost.equals(here.getHost()))) {
                prefs.edit().putString("origin", originOf(url)).apply();
                return false;
            }
            if (originOf(url).equals(prefs.getString("origin", null))) return false;
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException e) {
                // nowhere to open it
            }
            return true;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NavigationGuard.class);
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
