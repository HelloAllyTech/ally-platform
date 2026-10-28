plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.helloally.ally_mobile_flutter"
    // permission_handler_android requires compiling against API 37; the
    // Flutter-default flutter.compileSdkVersion (36 as of this Flutter
    // version) isn't enough. compileSdk is backward-compatible with lower
    // minSdk/targetSdk, so bumping it alone is safe.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // flutter_local_notifications needs this for the java.time APIs it
        // uses under the hood on API levels below 26.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // Overridden per flavor below.
        applicationId = "com.helloally.ally_mobile_flutter"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Mirrors ally-mobile (React Native)'s android/app/build.gradle
    // productFlavors. `prod` IS the store app: same applicationId, label and
    // App Links host as RN's prod flavor, so a Play upload is an update to
    // the existing listing. `dev` keeps this repo's own pre-cutover test id
    // (not RN's `com.helloally.app.dev`), so a test build never replaces
    // the real app or RN's own dev build on a tester's phone. See
    // docs/RELEASE.md. Flutter passes the flavor to Dart as `appFlavor`.
    flavorDimensions += "version"
    productFlavors {
        create("dev") {
            dimension = "version"
            applicationId = "com.helloally.ally_mobile_flutter"
            resValue("string", "app_name", "Ally Flutter")
            manifestPlaceholders["appLinkHost"] = "app.dev.helloally.ai"
        }
        create("prod") {
            dimension = "version"
            applicationId = "com.helloally.app"
            resValue("string", "app_name", "Ally")
            manifestPlaceholders["appLinkHost"] = "app.helloally.ai"
        }
    }

    // RN's release signing: android/app/ally-release.keystore decoded from
    // the ANDROID_RELEASE_KEYSTORE_BASE64 secret in CI, passwords from the
    // environment. Play only accepts an update to com.helloally.app signed
    // with this same upload key. Without the keystore (local builds) release
    // falls back to the debug key so `flutter run --release` still works.
    val releaseKeystore = file("ally-release.keystore")
    signingConfigs {
        create("release") {
            if (releaseKeystore.exists()) {
                storeFile = releaseKeystore
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig =
                if (releaseKeystore.exists()) {
                    signingConfigs.getByName("release")
                } else {
                    signingConfigs.getByName("debug")
                }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

// Firebase config is not in git (RN pulls it from S3 in CI; see
// docs/RELEASE.md). Apply google-services only when CI has placed a
// google-services.json, so local builds without one still work: the app
// then runs without push/Crashlytics (main.dart tolerates a failed
// Firebase.initializeApp()).
val googleServicesJson =
    listOf("google-services.json", "src/dev/google-services.json", "src/prod/google-services.json")
        .any { file(it).exists() }
if (googleServicesJson) {
    apply(plugin = "com.google.gms.google-services")
}

dependencies {
    // Pairs with isCoreLibraryDesugaringEnabled above — required by
    // flutter_local_notifications.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
