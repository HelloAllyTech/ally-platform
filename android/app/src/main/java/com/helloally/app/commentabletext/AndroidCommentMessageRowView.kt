package com.helloally.app.commentabletext

import android.content.Context
import android.graphics.Color
import android.util.AttributeSet
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.TextView

/**
 * A FrameLayout that wraps React Native <Text> children and enables
 * native text selection on the underlying ReactTextView.
 *
 * This follows the **exact same pattern** as the working
 * `@rob117/react-native-selectable-text` library:
 *
 *   1. Accept RN children via ViewGroupManager
 *   2. Recursively find the first TextView in the child hierarchy
 *   3. Call setTextIsSelectable(true) on it (AFTER window attachment!)
 *   4. Set up ActionMode callback for the floating selection menu
 *
 * The one addition over the library: when a menu item is clicked, we
 * emit the selection start/end indices + selected text via a callback,
 * so the JS side can use them for "Add comment" functionality.
 */
class AndroidCommentMessageRowView : FrameLayout {

    private var menuOptions: Array<String> = arrayOf("Add comment")
    private var textView: TextView? = null
    private var layoutObserver: ViewTreeObserver.OnGlobalLayoutListener? = null

    // ── Public state (set by ViewManager) ──────────────────────────
    var messageId: String = ""
    var onSelectionChangeListener: ((String, Int, Int, String) -> Unit)? = null

    // =====================================================================
    //  CLEAR SELECTION  (dismiss native ActionMode from JS)
    // =====================================================================

    /**
     * Programmatically clear the text selection on the found ReactTextView.
     * This also dismisses the native ActionMode ("Add comment" toolbar).
     */
    fun clearSelection() {
        textView?.let { tv ->
            val text = tv.text
            if (text is android.text.Spannable) {
                android.text.Selection.removeSelection(text)
            }
        }
    }

    constructor(context: Context) : super(context)
    constructor(context: Context, attrs: AttributeSet?) : super(context, attrs)
    constructor(context: Context, attrs: AttributeSet?, defStyleAttr: Int) : super(
        context, attrs, defStyleAttr
    )

    fun setMenuOptions(options: Array<String>) {
        this.menuOptions = options
        setupTextView()
    }

    // =====================================================================
    //  FIND & CONFIGURE THE ReactTextView  (copied from SelectableTextView)
    // =====================================================================

    private fun setupTextView() {
        // Recursively find the first TextView in the view hierarchy
        textView = findTextViewRecursive(this)
        if (textView != null) {
            android.util.Log.d("AndroidCommentMsgRow", "Found TextView: ${textView!!.javaClass.simpleName}")
            setupSelectionCallback(textView!!)
        } else {
            android.util.Log.w("AndroidCommentMsgRow", "No TextView found. Child count: $childCount")
            logViewHierarchy(this, 0)
        }
    }

    private fun findTextViewRecursive(view: View): TextView? {
        // Check if current view is a TextView (including subclasses like ReactTextView)
        if (view is TextView) {
            return view
        }

        // Recursively search in child views
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val child = view.getChildAt(i)
                findTextViewRecursive(child)?.let { return it }
            }
        }

        return null
    }

    private fun logViewHierarchy(view: View, depth: Int) {
        val indent = "  ".repeat(depth)
        android.util.Log.d(
            "AndroidCommentMsgRow",
            "$indent${view.javaClass.simpleName} (children: ${if (view is ViewGroup) view.childCount else 0})"
        )

        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                logViewHierarchy(view.getChildAt(i), depth + 1)
            }
        }
    }

    // =====================================================================
    //  SELECTION SETUP  (copied from SelectableTextView + indices addition)
    // =====================================================================

    private fun setupSelectionCallback(tv: TextView) {
        tv.setTextIsSelectable(true)
        // Explicit highlight colour so selection is visible regardless of theme
        tv.highlightColor = Color.argb(80, 33, 150, 243) // semi-transparent blue

        tv.customSelectionActionModeCallback = object : ActionMode.Callback {
            override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean {
                return true
            }

            override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean {
                menu?.clear()
                menuOptions.forEachIndexed { index, option ->
                    menu?.add(0, index, 0, option)
                }
                return true
            }

            override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean {
                val selectionStart = tv.selectionStart
                val selectionEnd = tv.selectionEnd
                val selectedText = tv.text.toString().substring(selectionStart, selectionEnd)

                // Emit selection event with indices (the addition over the library)
                onSelectionChangeListener?.invoke(
                    messageId, selectionStart, selectionEnd, selectedText
                )

                mode?.finish()
                return true
            }

            override fun onDestroyActionMode(mode: ActionMode?) {}
        }
    }

    // =====================================================================
    //  LIFECYCLE  (copied from SelectableTextView – wait for children)
    // =====================================================================

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        if (changed && textView == null) {
            // Post to ensure all child views are laid out
            post { setupTextView() }
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        // Use ViewTreeObserver to wait for layout to complete
        if (textView == null && layoutObserver == null) {
            layoutObserver = ViewTreeObserver.OnGlobalLayoutListener {
                if (textView == null) {
                    setupTextView()
                    // Remove observer after first successful setup
                    viewTreeObserver.removeOnGlobalLayoutListener(layoutObserver)
                    layoutObserver = null
                }
            }
            viewTreeObserver.addOnGlobalLayoutListener(layoutObserver)
        }
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        layoutObserver?.let {
            viewTreeObserver.removeOnGlobalLayoutListener(it)
            layoutObserver = null
        }
    }
}
