# Mea for Android

A native app (Capacitor) that opens your Mea full screen. Mea itself keeps running on your PC, so the
phone and the computer always show the same stories. The app reaches the PC through its ngrok
address, from home Wi-Fi or mobile data alike.

## What the app does

- **First start:** asks for Mea's address (or a whole pairing link from **Settings → Devices**) and a
  pairing code, then pairs like before. After that it opens straight into Mea.
- **Offline:** Mea's own offline copies still work (recent chats open from the saved copy; messages
  wait and go out when the PC is back).
- **Downloads:** book, library and memory exports go to the phone's Downloads folder.
- **Change address:** **Settings → Devices → This app → Change address**.
- It sends a custom user agent (`MeaApp/…`), which skips ngrok's free-plan warning page and lets
  Mea know it's in the app.

Not in the app yet: push notifications (web push doesn't exist in an Android WebView; it would need
Firebase), fingerprint unlock (the PIN lock works), PDF printing of books (EPUB and HTML download
fine), and sharing cards into Mea from other apps.

## Building

Needs a JDK 21 and the Android SDK (platform 36). `android/local.properties` points at the SDK.

```bash
bun run app:android
```

The APK lands in `android/app/build/outputs/apk/release/app-release.apk`. Copy it to the phone and
open it (allow "install unknown apps" for your file manager once).

## Signing key

Release builds are signed with `android/mea-release.jks`. Its passwords are in
`android/keystore.properties`. **Both stay out of git. Back them up somewhere safe:** Android only
installs an update over the app if it's signed with the same key. With a new key you'd have to
uninstall the app (and pair again) first.
