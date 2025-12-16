# React Native
# The following rules are necessary for React Native 0.79+
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep,allowobfuscation @interface com.facebook.common.internal.DoNotStrip

-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}

-keepclassmembers @com.facebook.proguard.annotations.KeepGettersAndSetters class * {
    void set*(***);
    *** get*();
}

-keep class * extends com.facebook.react.bridge.JavaScriptModule { *; }
-keep class * extends com.facebook.react.bridge.NativeModule { *; }
-keep class * extends com.facebook.react.uimanager.ViewManager { *; }
-keep class * extends com.facebook.react.uimanager.ShadowNode { *; }

-keepclassmembers,allowobfuscation class * {
    @com.facebook.common.internal.DoNotStrip <fields>;
}

-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.fabric.** { *; }

# Hermes
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase
-keepclassmembers class * extends com.facebook.react.uimanager.ViewManager {
   public void set*(...);
}

# React Native Reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbo.** { *; }

# React Native SVG
-keep class com.horcrux.svg.** { *; }

# React Native Video
-keep class com.brentvatne.react.** { *; }

# React Native Fast Image (if used, keeping just in case)
-keep class com.dylanvann.fastimage.** { *; }

# LiveKit / WebRTC
-keep class org.webrtc.** { *; }
-keep class livekit.org.webrtc.** { *; }
-keep class io.livekit.** { *; }

# Firebase
-dontwarn com.google.firebase.**
-keep class com.google.firebase.** { *; }

# Lottie
-keep class com.airbnb.lottie.** { *; }

# Vector Icons (if used)
-keep class com.oblador.vectoricons.** { *; }

# React Native Gesture Handler
-keep class com.swmansion.gesturehandler.** { *; }

# React Native Safe Area Context
-keep class com.th3rdwave.safeareacontext.** { *; }

# React Native Screens
-keep class com.swmansion.rnscreens.** { *; }

# React Native Permissions
-keep class com.zoontek.rnpermissions.** { *; }

# React Native Config
-keep class com.lugg.ReactNativeConfig.** { *; }
# Keep BuildConfig for react-native-config so it can access env vars
-keep class com.helloally.app.BuildConfig { *; }

# React Native Sound Player
-keep class com.johnsonsu.rnsoundplayer.** { *; }

# React Native Live Audio Stream
-keep class com.imxiqi.rnliveaudiostream.** { *; }

# React Native Webview
-keep class com.reactnativecommunity.webview.** { *; }

# General
-dontwarn com.facebook.react.**
