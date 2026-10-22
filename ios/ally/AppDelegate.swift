import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import Firebase

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  // Kept for native modules that still read `UIApplication.shared.delegate.window`
  // (react-native-firebase messaging crashes at launch with an unrecognized selector
  // without it). SceneDelegate assigns it once the scene connects.
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  // The window is created by SceneDelegate: iOS 27 refuses to launch an app that
  // has no UIScene lifecycle ("UIScene life cycle is required for app").
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FirebaseApp.configure()
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return true
  }
}

// Named explicitly so Info.plist's UISceneDelegateClassName can refer to it without
// the module prefix.
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let factory = (UIApplication.shared.delegate as? AppDelegate)?.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    (UIApplication.shared.delegate as? AppDelegate)?.window = window

    factory.startReactNative(
      withModuleName: "ally",
      in: window,
      launchOptions: Self.launchOptions(from: connectionOptions)
    )
  }

  // With scenes, a cold-start link no longer arrives in the app's launchOptions, which is
  // where React Native's Linking.getInitialURL() looks. Rebuild the same keys from the
  // scene's connection options.
  private static func launchOptions(
    from options: UIScene.ConnectionOptions
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    var result: [UIApplication.LaunchOptionsKey: Any] = [:]

    if let url = options.urlContexts.first?.url {
      result[.url] = url
    }
    if let activity = options.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }) {
      result[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": NSUserActivityTypeBrowsingWeb,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }

    return result.isEmpty ? nil : result
  }

  // Deep links while the app is already running (custom scheme).
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // Universal links while the app is already running.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
