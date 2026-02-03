import React

@objc(CommentableTextViewManager)
class CommentableTextViewManager: RCTViewManager {
  override func view() -> UIView! {
    return CommentableTextView()
  }

  override static func requiresMainQueueSetup() -> Bool {
    return true
  }
}

