package com.helloally.app.commentableText

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Dynamic
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter

/**
 * React Native ViewGroupManager that bridges [CommentableTextView] to JS.
 *
 * Uses **ViewGroupManager** (not SimpleViewManager) so that React Native children
 * (e.g. <Text> elements) are rendered inside the native FrameLayout.  The native
 * view then finds the underlying ReactTextView and enables selection on it –
 * following the exact same pattern as the working SelectableTextView library.
 *
 * JS component name: "CommentableTextView"
 *
 * Props:
 *   messageId   : String
 *   menuOptions : ReadableArray of strings
 *
 * Events → JS:
 *   onSelectionChange({ messageId, start, end, selectedText })
 */
class CommentableTextViewManager : ViewGroupManager<CommentableTextView>() {

    companion object {
        const val REACT_CLASS = "CommentableTextView"
    }

    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(reactContext: ThemedReactContext): CommentableTextView {
        val view = CommentableTextView(reactContext)

        view.onSelectionChangeListener = { messageId, start, end, selectedText ->
            val event = Arguments.createMap().apply {
                putString("messageId", messageId)
                putInt("start", start)
                putInt("end", end)
                putString("selectedText", selectedText)
            }
            val ctx = view.context as? ReactContext
            ctx?.getJSModule(RCTEventEmitter::class.java)
                ?.receiveEvent(view.id, "onSelectionChange", event)
        }

        view.onSingleTapListener = { messageId, offset ->
            val event = Arguments.createMap().apply {
                putString("messageId", messageId)
                putInt("offset", offset)
            }
            val ctx = view.context as? ReactContext
            ctx?.getJSModule(RCTEventEmitter::class.java)
                ?.receiveEvent(view.id, "onSingleTap", event)
        }

        return view
    }

    // ── Props ──────────────────────────────────────────────────────

    @ReactProp(name = "messageId")
    fun setMessageId(view: CommentableTextView, value: Dynamic?) {
        view.messageId = when (value?.type) {
            ReadableType.String -> value.asString()
            ReadableType.Number -> {
                val d = value.asDouble()
                if (d == d.toLong().toDouble()) d.toLong().toString() else d.toString()
            }
            else -> ""
        }
    }

    /**
     * Number of characters at the start of the text that are a prefix
     * (e.g. sender name). Selection indices emitted to JS are adjusted
     * so they are relative to the message content only.
     */
    @ReactProp(name = "prefixLength", defaultInt = 0)
    fun setPrefixLength(view: CommentableTextView, length: Int) {
        view.prefixLength = length
    }

    /**
     * When this value changes (increments), clear any active text selection
     * on the underlying ReactTextView.  This also dismisses the native
     * ActionMode floating toolbar ("Add comment").
     */
    @ReactProp(name = "clearSelectionSignal", defaultInt = 0)
    fun setClearSelectionSignal(view: CommentableTextView, signal: Int) {
        if (signal > 0) {
            view.clearSelection()
        }
    }

    @ReactProp(name = "menuOptions")
    fun setMenuOptions(view: CommentableTextView, menuOptions: ReadableArray?) {
        if (menuOptions != null) {
            val options = Array(menuOptions.size()) { i ->
                menuOptions.getString(i) ?: ""
            }
            view.setMenuOptions(options)
        }
    }

    // ── Event registration ─────────────────────────────────────────

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any>? {
        return MapBuilder.builder<String, Any>()
            .put("onSelectionChange", MapBuilder.of("registrationName", "onSelectionChange"))
            .put("onSingleTap", MapBuilder.of("registrationName", "onSingleTap"))
            .build()
    }
}
