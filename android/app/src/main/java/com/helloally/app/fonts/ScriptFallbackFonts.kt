package com.helloally.app.fonts

import android.content.Context
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.graphics.fonts.FontStyle
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import com.facebook.react.common.assets.ReactFontManager

/**
 * Gives the app's Latin-only bundled fonts an Indic fallback.
 *
 * Every font we ship (IBM Plex Serif, Replay Pro, Roboto, Yeseva One) has zero
 * Devanagari, Tamil or Kannada glyphs. Android does not add a fallback chain to a
 * typeface loaded from assets, so on ROMs that don't cover for us — Samsung One UI
 * and Xiaomi MIUI, per field reports from a Galaxy Tab A7 and a Redmi 12 — that
 * text draws as blank space or tofu. A language picker whose rows render empty
 * reads to the user as a dead control.
 *
 * [Typeface.CustomFallbackBuilder] fixes this at the source: each family name JS
 * asks for is registered as its real font *plus* the Noto Sans face for each script
 * we serve, so a single string can mix Latin brand type with Indic glyphs and
 * nothing on the JS side needs to know. `setSystemFallback` keeps the platform
 * chain behind ours, so emoji and scripts we don't bundle still resolve.
 *
 * API 29+ only — that builder does not exist below it. Android 7–9 is covered by
 * `installScriptSafeFontFallback` in `src/theme/scriptSafeFontFallback.ts`, which
 * gates itself to those versions; the two are halves of one fix.
 */
object ScriptFallbackFonts {

    private const val TAG = "ScriptFallbackFonts"
    private const val ASSET_DIR = "fonts"

    private const val WEIGHT_REGULAR = 400
    private const val WEIGHT_MEDIUM = 500
    private const val WEIGHT_BOLD = 700

    private data class BundledFont(
        val family: String,
        val asset: String,
        val weight: Int = WEIGHT_REGULAR,
        val italic: Boolean = false,
    )

    /**
     * Font family names as JS asks for them (`src/theme/fonts.ts`), each with the asset
     * it loads from and the weight that asset really is. Roboto-ExtraLight is
     * intentionally absent: the token exists but the file does not, so it already
     * resolves to the system Roboto.
     */
    private val BUNDLED_FONTS =
        listOf(
            BundledFont("IBMPlexSerif-Regular", "IBMPlexSerif-Regular.ttf"),
            BundledFont("IBMPlexSerif-Medium", "IBMPlexSerif-Medium.ttf", WEIGHT_MEDIUM),
            BundledFont("Roboto-Regular", "Roboto-Regular.ttf"),
            BundledFont("ReplayPro-Headline", "ReplayPro-Headline.otf"),
            BundledFont("ReplayPro-Bold", "ReplayPro-Bold.otf", WEIGHT_BOLD),
            BundledFont(
                "ReplayPro-BoldItalic",
                "ReplayPro-BoldItalic.otf",
                WEIGHT_BOLD,
                italic = true,
            ),
            BundledFont("YesevaOne-Regular", "YesevaOne-Regular.ttf"),
        )

    /**
     * One entry per script, regular and bold, so the platform picks a weight inside the
     * fallback rather than synthesising one. Add a script here and to `assets/fonts/`
     * together.
     */
    private val FALLBACK_FONTS =
        listOf(
            "NotoSansDevanagari-Regular.ttf" to "NotoSansDevanagari-Bold.ttf",
            "NotoSansTamil-Regular.ttf" to "NotoSansTamil-Bold.ttf",
            "NotoSansKannada-Regular.ttf" to "NotoSansKannada-Bold.ttf",
        )

    /**
     * Register the fallback-carrying typefaces. Call once from `Application.onCreate`,
     * before any React view renders.
     *
     * Failure is never fatal: a family we cannot build is left unregistered and React
     * Native loads it from assets the way it always did.
     */
    @JvmStatic
    fun install(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        register(context)
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun register(context: Context) {
        val fallbacks =
            FALLBACK_FONTS.mapNotNull { (regular, bold) ->
                try {
                    FontFamily.Builder(font(context, regular, WEIGHT_REGULAR))
                        .addFont(font(context, bold, WEIGHT_BOLD))
                        .build()
                } catch (error: Exception) {
                    Log.w(TAG, "Skipping Indic fallback $regular", error)
                    null
                }
            }

        if (fallbacks.isEmpty()) {
            Log.w(TAG, "No Indic fallback built; leaving font resolution untouched")
            return
        }

        BUNDLED_FONTS.forEach { bundled ->
            try {
                val base =
                    FontFamily.Builder(
                            font(context, bundled.asset, bundled.weight, bundled.italic)
                        )
                        .build()
                val typeface =
                    Typeface.CustomFallbackBuilder(base)
                        .apply { fallbacks.forEach { addCustomFallback(it) } }
                        .setSystemFallback("sans-serif")
                        .build()
                ReactFontManager.getInstance().addCustomFont(bundled.family, typeface)
            } catch (error: Exception) {
                Log.w(TAG, "Leaving ${bundled.family} on the default asset loader", error)
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun font(
        context: Context,
        asset: String,
        weight: Int,
        italic: Boolean = false,
    ): Font =
        Font.Builder(context.assets, "$ASSET_DIR/$asset")
            .setWeight(weight)
            .setSlant(
                if (italic) FontStyle.FONT_SLANT_ITALIC else FontStyle.FONT_SLANT_UPRIGHT
            )
            .build()
}
