import UIKit
import React

@objc(CommentableTextView)
class CommentableTextView: UITextView, UITextViewDelegate, UIGestureRecognizerDelegate {
  @objc var commentRanges: NSArray = [] {
    didSet { updateAttributedText() }
  }

  @objc var prefixLength: NSNumber = 0 {
    didSet { updateAttributedText() }
  }

  @objc var textStyle: NSDictionary? {
    didSet { updateAttributedText() }
  }

  @objc var partTextStyle: NSDictionary? {
    didSet { updateAttributedText() }
  }

  @objc var prefixTextStyle: NSDictionary? {
    didSet { updateAttributedText() }
  }

  @objc var highlightStyle: NSDictionary? {
    didSet { updateAttributedText() }
  }

  @objc var selection: NSDictionary? {
    didSet { applySelectionIfNeeded() }
  }

  @objc var selectableEnabled: Bool = true {
    didSet {
      isSelectable = selectableEnabled
      isUserInteractionEnabled = selectableEnabled
    }
  }

  @objc var multiline: Bool = true {
    didSet {}
  }

  @objc var onCommentableSelectionChange: RCTDirectEventBlock?
  @objc var onCommentPress: RCTBubblingEventBlock?
  @objc var onCommentableContentSizeChange: RCTDirectEventBlock?

  private let commentKey = NSAttributedString.Key("CommentIds")
  private var isUpdatingText = false
  private var isApplyingSelection = false
  private var lastKnownWidth: CGFloat = 0
  private var lastEmittedHeight: CGFloat = 0

  override init(frame: CGRect, textContainer: NSTextContainer?) {
    super.init(frame: frame, textContainer: textContainer)
    setup()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setup()
  }

  private func setup() {
    isEditable = false
    isSelectable = true
    isScrollEnabled = false
    backgroundColor = .clear
    textContainerInset = .zero
    textContainer.lineFragmentPadding = 0
    delegate = self

    // Double-tap recognizer — UITextView handles word selection natively;
    // this exists so the single-tap can use require(toFail:).
    // cancelsTouchesInView = false + delegate allows it to coexist with
    // UITextView's built-in double-tap-to-select-word recognizer.
    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTap(_:)))
    doubleTap.numberOfTapsRequired = 2
    doubleTap.cancelsTouchesInView = false
    doubleTap.delegate = self
    addGestureRecognizer(doubleTap)

    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    tap.cancelsTouchesInView = false
    tap.require(toFail: doubleTap)
    addGestureRecognizer(tap)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if bounds.width != lastKnownWidth {
      lastKnownWidth = bounds.width
      invalidateIntrinsicContentSize()
    }

    // Emit current content height to JS so it can set an explicit
    // height on the native view, removing the need for a hidden
    // measurement overlay.
    let width = bounds.width > 0 ? bounds.width : UIScreen.main.bounds.width
    let fittingSize = CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)
    let fitted = sizeThatFits(fittingSize)
    let height = ceil(fitted.height)
    if height > 0 && height != lastEmittedHeight {
      lastEmittedHeight = height
      onCommentableContentSizeChange?(["height": height])
    }
  }

  override var intrinsicContentSize: CGSize {
    let width = bounds.width > 0 ? bounds.width : UIScreen.main.bounds.width
    let fittingSize = CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)
    let size = sizeThatFits(fittingSize)
    return CGSize(width: UIView.noIntrinsicMetric, height: size.height)
  }

  override var text: String! {
    didSet {
      if isUpdatingText { return }
      updateAttributedText()
    }
  }

  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    return false
  }

  private func attributesFromStyle(_ style: NSDictionary?) -> [NSAttributedString.Key: Any] {
    guard let style else { return [:] }

    var attrs: [NSAttributedString.Key: Any] = [:]

    if let color = style["color"] {
      if let uiColor = RCTConvert.uiColor(color) {
        attrs[.foregroundColor] = uiColor
      }
    }

    if let backgroundColor = style["backgroundColor"] {
      if let uiColor = RCTConvert.uiColor(backgroundColor) {
        attrs[.backgroundColor] = uiColor
      }
    }

    let fontFamily = style["fontFamily"] as? String
    let fontSize = style["fontSize"] as? NSNumber
    let fontWeight = style["fontWeight"] as? String
    let fontStyle = style["fontStyle"] as? String

    if fontFamily != nil || fontSize != nil || fontWeight != nil || fontStyle != nil {
      let font = RCTFont.update(
        nil,
        withFamily: fontFamily,
        size: fontSize,
        weight: fontWeight,
        style: fontStyle,
        variant: nil,
        scaleMultiplier: 1.0
      )
      if let font {
        attrs[.font] = font
      }
    }

    if let letterSpacing = style["letterSpacing"] as? NSNumber {
      attrs[.kern] = letterSpacing
    }

    if let lineHeight = style["lineHeight"] as? NSNumber {
      let paragraphStyle = NSMutableParagraphStyle()
      paragraphStyle.minimumLineHeight = CGFloat(truncating: lineHeight)
      paragraphStyle.maximumLineHeight = CGFloat(truncating: lineHeight)
      attrs[.paragraphStyle] = paragraphStyle
    }

    return attrs
  }

  private func updateAttributedText() {
    let fullText = text ?? ""
    let baseAttributes = attributesFromStyle(textStyle)
    let attributed = NSMutableAttributedString(string: fullText, attributes: baseAttributes)

    let prefixLen = max(0, min(fullText.count, prefixLength.intValue))
    let fullRange = NSRange(location: 0, length: attributed.length)

    if let partAttrs = partTextStyle {
      let partAttributes = attributesFromStyle(partAttrs)
      if prefixLen < attributed.length {
        attributed.addAttributes(
          partAttributes,
          range: NSRange(location: prefixLen, length: attributed.length - prefixLen)
        )
      }
    }

    if let prefixAttrs = prefixTextStyle, prefixLen > 0 {
      let prefixAttributes = attributesFromStyle(prefixAttrs)
      attributed.addAttributes(prefixAttributes, range: NSRange(location: 0, length: prefixLen))
    }

    for rangeEntry in commentRanges {
      guard let dict = rangeEntry as? NSDictionary else { continue }
      guard let start = dict["start"] as? NSNumber,
            let end = dict["end"] as? NSNumber else { continue }
      let s = max(0, min(start.intValue, attributed.length))
      let e = max(0, min(end.intValue, attributed.length))
      if e <= s { continue }

      let range = NSRange(location: s, length: e - s)
      let commentIds = dict["commentIds"] as? [String] ?? []
      let highlighted = dict["highlighted"] as? Bool ?? true

      if !commentIds.isEmpty {
        attributed.addAttribute(commentKey, value: commentIds, range: range)
      }

      if highlighted {
        let highlightAttrs = attributesFromStyle(highlightStyle)
        if let background = highlightAttrs[.backgroundColor] {
          attributed.addAttribute(.backgroundColor, value: background, range: range)
        }

        if let borderBottomWidth = highlightStyle?["borderBottomWidth"] as? NSNumber,
           borderBottomWidth.doubleValue > 0 {
          attributed.addAttribute(
            .underlineStyle,
            value: NSUnderlineStyle.single.rawValue,
            range: range
          )
          if let borderBottomColor = highlightStyle?["borderBottomColor"] {
            if let uiColor = RCTConvert.uiColor(borderBottomColor) {
              attributed.addAttribute(.underlineColor, value: uiColor, range: range)
            }
          }
        }
      }
    }

    let currentSelection = selectedRange
    isUpdatingText = true
    attributedText = attributed
    isUpdatingText = false

    if fullRange.length >= currentSelection.location + currentSelection.length {
      selectedRange = currentSelection
    }
  }

  private func applySelectionIfNeeded() {
    guard let selection,
          let start = selection["start"] as? NSNumber,
          let end = selection["end"] as? NSNumber else { return }

    let s = max(0, min(start.intValue, (text ?? "").count))
    let e = max(0, min(end.intValue, (text ?? "").count))
    if e < s { return }

    isApplyingSelection = true
    selectedRange = NSRange(location: s, length: e - s)
    isApplyingSelection = false
  }

  func textViewDidChangeSelection(_ textView: UITextView) {
    if isApplyingSelection { return }
    let range = textView.selectedRange

    var payload: [String: Any] = [
      "start": range.location,
      "end": range.location + range.length,
    ]

    if let selectedTextRange = textView.selectedTextRange {
      let rectInView = textView.firstRect(for: selectedTextRange)
      let rectInWindow = textView.convert(rectInView, to: nil)
      payload["selectionRect"] = [
        "x": rectInWindow.origin.x,
        "y": rectInWindow.origin.y,
        "width": rectInWindow.size.width,
        "height": rectInWindow.size.height,
      ]
    }

    onCommentableSelectionChange?(payload)
  }

  // MARK: - UIGestureRecognizerDelegate

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    // Allow our double-tap recognizer to coexist with UITextView's
    // built-in double-tap-to-select-word recognizer so both fire.
    return true
  }

  @objc private func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
    // Intentionally empty. UITextView handles double-tap for word
    // selection natively. This recognizer exists only so the single-tap
    // can use require(toFail:).
  }

  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    let location = gesture.location(in: self)
    var textContainerPoint = location
    textContainerPoint.x -= textContainerInset.left
    textContainerPoint.y -= textContainerInset.top

    let index = layoutManager.characterIndex(
      for: textContainerPoint,
      in: textContainer,
      fractionOfDistanceBetweenInsertionPoints: nil
    )

    if index >= textStorage.length { return }
    var effectiveRange = NSRange(location: 0, length: 0)
    if let ids = attributedText.attribute(commentKey, at: index, effectiveRange: &effectiveRange) as? [String],
       !ids.isEmpty {
      onCommentPress?([
        "commentIds": ids,
        "start": effectiveRange.location,
        "end": effectiveRange.location + effectiveRange.length,
      ])
    }
  }
}

