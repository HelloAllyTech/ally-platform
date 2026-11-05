package com.helloally.app.commentableText

import android.content.Context
import android.graphics.Color
import android.text.Selection
import android.text.Spannable
import android.text.SpanWatcher
import android.text.Spanned
import android.util.AttributeSet
import android.view.ActionMode
import android.view.GestureDetector
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.TextView

/**
 * A FrameLayout that wraps React Native <Text> children and enables
 * native text selection on the underlying ReactTextView.
 *
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
class CommentableTextView : FrameLayout {

    private var menuOptions: Array<String> = arrayOf("Add comment")
    private var textView: TextView? = null
    private var layoutObserver: ViewTreeObserver.OnGlobalLayoutListener? = null
    private var gestureDetector: GestureDetector? = null

    // ── Public state (set by ViewManager) ──────────────────────────
    var messageId: String = ""
    /** Number of characters at the start of the text that are a non-selectable
     *  prefix (e.g. sender name).  Selection indices emitted to JS are offset
     *  by this amount so they are relative to the message content only. */
    var prefixLength: Int = 0
    var onSelectionChangeListener: ((String, Int, Int, String) -> Unit)? = null
    /** Fires on genuine single tap with (messageId, adjustedCharOffset).
     *  Does NOT fire for long-press or double-tap. */
    var onSingleTapListener: ((String, Int) -> Unit)? = null

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
            if (text is Spannable) {
                Selection.removeSelection(text)
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
        textView = findTextViewRecursive(this)
        if (textView != null) {
            android.util.Log.d("CommentableTextView", "Found TextView: ${textView!!.javaClass.simpleName}")
            setupSelectionCallback(textView!!)
        } else {
            android.util.Log.w("CommentableTextView", "No TextView found. Child count: $childCount")
            logViewHierarchy(this, 0)
        }
    }

    private fun findTextViewRecursive(view: View): TextView? {
        if (view is TextView) {
            return view
        }

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
            "CommentableTextView",
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
        tv.highlightColor = Color.argb(80, 33, 150, 243) // semi-transparent blue

        tv.customSelectionActionModeCallback = object : ActionMode.Callback {
            override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean {
                if (prefixLength > 0) {
                    val s = tv.selectionStart
                    val e = tv.selectionEnd
                    if (s < prefixLength && e <= prefixLength) {
                        return false
                    }
                }
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
                val rawStart = maxOf(tv.selectionStart, prefixLength)
                val rawEnd   = maxOf(tv.selectionEnd,   prefixLength)

                if (rawStart >= rawEnd) {
                    mode?.finish()
                    return true
                }

                val adjustedStart = rawStart - prefixLength
                val adjustedEnd   = rawEnd   - prefixLength
                val selectedText  = tv.text.toString().substring(rawStart, rawEnd)

                onSelectionChangeListener?.invoke(
                    messageId, adjustedStart, adjustedEnd, selectedText
                )

                mode?.finish()
                return true
            }

            override fun onDestroyActionMode(mode: ActionMode?) {}
        }

        gestureDetector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean = true

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                val listener = onSingleTapListener ?: return false
                val layout = tv.layout ?: return false

                val tvLoc = IntArray(2)
                val myLoc = IntArray(2)
                tv.getLocationOnScreen(tvLoc)
                this@CommentableTextView.getLocationOnScreen(myLoc)

                val textX = e.x + myLoc[0] - tvLoc[0] - tv.totalPaddingLeft + tv.scrollX
                val textY = e.y + myLoc[1] - tvLoc[1] - tv.totalPaddingTop + tv.scrollY

                val line = layout.getLineForVertical(textY.toInt())
                val offset = layout.getOffsetForHorizontal(line, textX)

                val adjustedOffset = offset - prefixLength
                if (adjustedOffset < 0) return false

                listener.invoke(messageId, adjustedOffset)
                return true
            }
        })
    }

    // =====================================================================
    //  SELECTION CLAMPING – prevent handles from entering the prefix
    // =====================================================================

    private var isClampingSelection = false
    /** The Spannable instance we last attached the SpanWatcher to. */
    private var watchedSpannable: Spannable? = null

    /**
     * Attach a [SpanWatcher] to the current Spannable of the found TextView.
     * The watcher fires **synchronously** every time the selection start/end
     * span changes (long-press, double-tap, handle drag) and clamps it so
     * the handles can never enter the prefix area.
     *
     * Called on every ACTION_DOWN to survive React text re-renders (which
     * replace the entire Spannable).
     */
    private fun ensureSelectionClamp() {
        val tv = textView ?: return
        val text = tv.text as? Spannable ?: return
        if (text === watchedSpannable) return
        watchedSpannable = text

        text.setSpan(object : SpanWatcher {
            override fun onSpanChanged(
                buf: Spannable, what: Any,
                ostart: Int, oend: Int, nstart: Int, nend: Int
            ) {
                if (isClampingSelection || prefixLength <= 0) return
                if (what !== Selection.SELECTION_START && what !== Selection.SELECTION_END) return

                val selStart = Selection.getSelectionStart(buf)
                val selEnd = Selection.getSelectionEnd(buf)
                if (selStart < 0 || selEnd < 0) return

                if (selStart < prefixLength || selEnd < prefixLength) {
                    isClampingSelection = true
                    val cs = maxOf(selStart, prefixLength)
                    val ce = maxOf(selEnd, prefixLength)
                    if (cs >= ce) {
                        Selection.removeSelection(buf)
                    } else {
                        Selection.setSelection(buf, cs, ce)
                    }
                    isClampingSelection = false
                }
            }

            override fun onSpanAdded(text: Spannable, what: Any, start: Int, end: Int) {}
            override fun onSpanRemoved(text: Spannable, what: Any, start: Int, end: Int) {}
        }, 0, text.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    }

    /**
     * On every ACTION_DOWN make sure the SpanWatcher is on the current
     * Spannable (React may have replaced the text since the last gesture).
     */
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (prefixLength > 0 && event.action == MotionEvent.ACTION_DOWN) {
            ensureSelectionClamp()
        }
        gestureDetector?.onTouchEvent(event)
        return super.dispatchTouchEvent(event)
    }

    // =====================================================================
    //  LIFECYCLE  (copied from SelectableTextView – wait for children)
    // =====================================================================

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        if (changed && textView == null) {
            post { setupTextView() }
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (textView == null && layoutObserver == null) {
            layoutObserver = ViewTreeObserver.OnGlobalLayoutListener {
                if (textView == null) {
                    setupTextView()
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
