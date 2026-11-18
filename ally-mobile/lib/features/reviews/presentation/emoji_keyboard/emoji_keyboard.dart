import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'emoji_keyboard_data.dart';

/// iOS system font: an RN `<Text>`/`<TextInput>` with no `fontFamily`.
const _systemFont = 'CupertinoSystemText';

/// rn-emoji-keyboard `defaultTheme`.
abstract final class _Theme {
  static const backdrop = Color(0x55000000);
  static const knob = Color(0xFFFFFFFF);
  static const container = Color(0xFFFFFFFF);
  static const header = Color(0x99000000);
  static const skinTonesContainer = Color(0xFFE3DBCD);
  static const categoryIcon = Color(0xFF000000);
  static const categoryIconActive = Color(0xFF005B96);
  static const categoryContainer = Color(0xFFE3DBCD);
  static const categoryContainerActive = Color(0xFFFFFFFF);
  static const searchText = Color(0xCC000000);
  static const searchPlaceholder = Color(0x55000000);
  static const searchIcon = Color(0x55000000);
  static const searchBackground = Color(0x11000000);
  static const hairline = Color(0x11000000);
}

/// rn-emoji-keyboard `translation/en.ts` (the app passes no `translation`).
const _categoryTitles = {
  'recently_used': 'Recently used',
  'smileys_emotion': 'Smileys & Emotion',
  'people_body': 'People & Body',
  'animals_nature': 'Animals & Nature',
  'food_drink': 'Food & Drink',
  'travel_places': 'Travel & Places',
  'activities': 'Activities',
  'objects': 'Objects',
  'symbols': 'Symbols',
  'flags': 'Flags',
  'search': 'Search',
};

const _emojiSize = 28.0;
const _categoryElementWidth = 37.0;

/// Port of `rn-emoji-keyboard` 1.7.0's `EmojiPicker` (MIT, The Widlarz
/// Group), as RN's `ShareReviewLayout` opens it: `allowMultipleSelections`,
/// `enableRecentlyUsed`, `enableSearchBar`, `hideHeader`, everything else at
/// the library defaults — a bottom sheet 40% of the screen tall (drag the
/// knob up past 50pt for 80%, down past 150pt to close) over a `#00000055`
/// backdrop; a rounded search bar; the emoji categories as horizontally
/// paged 28pt grids (`floor(width / 56)` columns); the floating category
/// bar with its sliding active indicator; the recently-used category
/// (app-session memory, after Flags) and the search results page; long
/// press opens the five skin-tone variants of a tone-enabled emoji.
class EmojiKeyboard extends StatefulWidget {
  const EmojiKeyboard({
    super.key,
    required this.onEmojiSelected,
    required this.onClose,
    this.allowMultipleSelections = false,
    this.enableRecentlyUsed = false,
    this.enableSearchBar = false,
    this.hideHeader = false,
    this.categories,
  });

  /// Receives the emoji glyph (RN `emoji.emoji`).
  final ValueChanged<String> onEmojiSelected;
  final VoidCallback onClose;
  final bool allowMultipleSelections;
  final bool enableRecentlyUsed;
  final bool enableSearchBar;
  final bool hideHeader;

  /// Injected data (tests); defaults to the bundled `emojis.json`.
  final List<EmojiCategoryData>? categories;

  static Future<void> show(
    BuildContext context, {
    required ValueChanged<String> onEmojiSelected,
    bool allowMultipleSelections = false,
    bool enableRecentlyUsed = false,
    bool enableSearchBar = false,
    bool hideHeader = false,
    List<EmojiCategoryData>? categories,
  }) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: _Theme.backdrop,
      transitionDuration: const Duration(milliseconds: 250),
      pageBuilder: (dialogContext, _, _) => EmojiKeyboard(
        onEmojiSelected: onEmojiSelected,
        onClose: () => Navigator.of(dialogContext).pop(),
        allowMultipleSelections: allowMultipleSelections,
        enableRecentlyUsed: enableRecentlyUsed,
        enableSearchBar: enableSearchBar,
        hideHeader: hideHeader,
        categories: categories,
      ),
      // ModalWithBackdrop: the sheet springs up from below the screen.
      transitionBuilder: (_, animation, _, child) => SlideTransition(
        position: Tween(
          begin: const Offset(0, 1),
          end: Offset.zero,
        ).animate(CurvedAnimation(parent: animation, curve: Curves.easeOutCubic)),
        child: child,
      ),
    );
  }

  @override
  State<EmojiKeyboard> createState() => _EmojiKeyboardState();
}

class _ToneData {
  const _ToneData(this.variants, this.anchor);

  final List<KeyboardEmoji> variants;

  /// The long-pressed cell, in the pages area's coordinates.
  final Rect anchor;
}

class _EmojiKeyboardState extends State<EmojiKeyboard> {
  late final Future<List<EmojiCategoryData>> _data = widget.categories != null
      ? Future.value(widget.categories!)
      : loadEmojiCategories();
  final _pageController = PageController();
  final _searchController = TextEditingController();
  final _searchFocus = FocusNode();
  final _pagesKey = GlobalKey();

  int _activeIndex = 0;
  String _phrase = '';
  bool _expanded = false;
  double _dragOffset = 0;
  _ToneData? _tones;

  @override
  void initState() {
    super.initState();
    RecentEmojis.recentlyUsed.addListener(_onRecents);
  }

  @override
  void dispose() {
    RecentEmojis.recentlyUsed.removeListener(_onRecents);
    _pageController.dispose();
    _searchController.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  void _onRecents() {
    if (mounted) setState(() {});
  }

  /// KeyboardProvider `renderList`: the categories, then Recently used (when
  /// enabled and non-empty), then Search (when the search bar is on).
  List<EmojiCategoryData> _renderList(List<EmojiCategoryData> all) {
    final recents = RecentEmojis.recentlyUsed.value;
    return [
      ...all,
      if (widget.enableRecentlyUsed && recents.isNotEmpty) EmojiCategoryData('recently_used', recents),
      if (widget.enableSearchBar) EmojiCategoryData('search', searchEmojis(all, _phrase)),
    ];
  }

  void _select(KeyboardEmoji emoji) {
    // EmojiCategory.handleEmojiPress: RECENT_EMOJI_ADD, then report; the
    // picker closes unless multiple selections are allowed.
    RecentEmojis.add(emoji);
    widget.onEmojiSelected(emoji.emoji);
    if (!widget.allowMultipleSelections) widget.onClose();
  }

  void _clearTones() {
    if (_tones != null) setState(() => _tones = null);
  }

  void _goTo(int index, {bool animate = true}) {
    _clearTones();
    setState(() => _activeIndex = index);
    if (!_pageController.hasClients) return;
    if (animate) {
      _pageController.animateToPage(index, duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    } else {
      _pageController.jumpToPage(index);
    }
  }

  /// SearchBar `handleSearch`.
  void _onSearch(String text, List<EmojiCategoryData> renderList) {
    setState(() => _phrase = text);
    if (text.isEmpty) {
      _goTo(0);
      return;
    }
    final searchIndex = renderList.indexWhere((c) => c.title == 'search');
    if (searchIndex != -1) _goTo(searchIndex);
  }

  /// SearchBar `clearPhrase`.
  void _clearPhrase() {
    _searchController.clear();
    setState(() => _phrase = '');
    _goTo(0);
    _searchFocus.unfocus();
  }

  void _onLongPress(KeyboardEmoji emoji, BuildContext cellContext) {
    if (!emoji.toneEnabled) {
      _clearTones();
      return;
    }
    final pages = _pagesKey.currentContext?.findRenderObject() as RenderBox?;
    final cell = cellContext.findRenderObject() as RenderBox?;
    if (pages == null || cell == null) return;
    final topLeft = cell.localToGlobal(Offset.zero, ancestor: pages);
    setState(() => _tones = _ToneData(skinToneVariants(emoji), topLeft & cell.size));
  }

  void _onKnobDragEnd(DragEndDetails _) {
    final dy = _dragOffset;
    setState(() => _dragOffset = 0);
    if (dy < -50) {
      setState(() => _expanded = true);
    } else if (dy > 150) {
      widget.onClose();
    } else {
      setState(() => _expanded = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final keyboardInset = media.viewInsets.bottom;
    final baseHeight = media.size.height * (_expanded ? 0.8 : 0.4);
    // EmojiPicker: height − drag offset, plus the system keyboard's height
    // while it's up (and the sheet isn't expanded).
    final height = math.max(0.0, baseHeight - _dragOffset + (_expanded ? 0 : keyboardInset));
    final columns = math.max(1, (media.size.width / (_emojiSize * 2)).floor());

    return Align(
      alignment: Alignment.bottomCenter,
      child: SafeArea(
        top: false,
        child: Material(
          type: MaterialType.transparency,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Knob: a 50x6 white pill, 20pt padding above, pannable.
              GestureDetector(
                key: const Key('emoji-keyboard-knob'),
                behavior: HitTestBehavior.opaque,
                onVerticalDragStart: (_) => FocusScope.of(context).unfocus(),
                onVerticalDragUpdate: (d) => setState(() => _dragOffset += d.delta.dy),
                onVerticalDragEnd: _onKnobDragEnd,
                child: Padding(
                  padding: const EdgeInsets.only(left: 20, right: 20, top: 20, bottom: 6),
                  child: Container(
                    width: 50,
                    height: 6,
                    decoration: BoxDecoration(
                      color: _Theme.knob,
                      borderRadius: BorderRadius.circular(4),
                      boxShadow: const [BoxShadow(color: Color(0x26000000), blurRadius: 5)],
                    ),
                  ),
                ),
              ),
              Container(
                key: const Key('emoji-keyboard'),
                height: height,
                decoration: BoxDecoration(
                  color: _Theme.container,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: const [BoxShadow(color: Color(0x26000000), blurRadius: 5)],
                ),
                clipBehavior: Clip.antiAlias,
                child: FutureBuilder<List<EmojiCategoryData>>(
                  future: _data,
                  builder: (context, snapshot) {
                    final all = snapshot.data;
                    if (all == null) return const SizedBox.shrink();
                    final renderList = _renderList(all);
                    final active = _activeIndex.clamp(0, renderList.length - 1);
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (widget.enableSearchBar)
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: _SearchBar(
                              controller: _searchController,
                              focusNode: _searchFocus,
                              onChanged: (text) => _onSearch(text, renderList),
                              onTap: _clearTones,
                              onClear: _clearPhrase,
                            ),
                          ),
                        Expanded(
                          child: Stack(
                            key: _pagesKey,
                            children: [
                              PageView.builder(
                                controller: _pageController,
                                itemCount: renderList.length,
                                onPageChanged: (index) {
                                  _clearTones();
                                  setState(() => _activeIndex = index);
                                },
                                itemBuilder: (context, index) => _EmojiCategoryPage(
                                  key: ValueKey(renderList[index].title),
                                  category: renderList[index],
                                  columns: columns,
                                  hideHeader: widget.hideHeader,
                                  bottomInset: keyboardInset,
                                  onPress: (emoji) {
                                    _clearTones();
                                    _select(emoji);
                                  },
                                  onLongPress: _onLongPress,
                                  onScroll: _clearTones,
                                ),
                              ),
                              // Categories (categoryPosition 'floating').
                              Positioned(
                                left: 20,
                                right: 20,
                                bottom: 20,
                                child: Center(
                                  child: _CategoryBar(
                                    titles: [for (final c in renderList) c.title],
                                    activeIndex: active,
                                    pageController: _pageController,
                                    onSelect: _goTo,
                                  ),
                                ),
                              ),
                              if (_tones != null) _SkinTones(data: _tones!, onPress: _select),
                            ],
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// rn-emoji-keyboard `SearchBar`.
class _SearchBar extends StatelessWidget {
  const _SearchBar({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
    required this.onTap,
    required this.onClear,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;
  final VoidCallback onTap;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 16, right: 8),
      decoration: BoxDecoration(
        color: _Theme.searchBackground,
        borderRadius: BorderRadius.circular(100),
        border: Border.all(color: _Theme.hairline),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              key: const Key('emoji-keyboard-search'),
              controller: controller,
              focusNode: focusNode,
              onChanged: onChanged,
              onTap: onTap,
              cursorColor: _Theme.searchText,
              style: const TextStyle(fontFamily: _systemFont, fontSize: 14, color: _Theme.searchText),
              decoration: const InputDecoration(
                isDense: true,
                border: InputBorder.none,
                hintText: 'Search',
                hintStyle: TextStyle(fontFamily: _systemFont, fontSize: 14, color: _Theme.searchPlaceholder),
                contentPadding: EdgeInsets.symmetric(vertical: 8, horizontal: 12),
              ),
            ),
          ),
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: controller,
            builder: (context, value, _) => value.text.isEmpty
                ? const SizedBox.shrink()
                : GestureDetector(
                    key: const Key('emoji-keyboard-search-clear'),
                    onTap: onClear,
                    child: const Padding(
                      padding: EdgeInsets.only(right: 8),
                      child: _PngIcon('close', color: _Theme.searchIcon),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// rn-emoji-keyboard `PngIcon`: a 22x22 tinted PNG.
class _PngIcon extends StatelessWidget {
  const _PngIcon(this.name, {required this.color});

  final String name;
  final Color color;

  @override
  Widget build(BuildContext context) => Image.asset(
    'assets/emoji_keyboard/$name.png',
    width: 22,
    height: 22,
    color: color,
    colorBlendMode: BlendMode.srcIn,
  );
}

/// rn-emoji-keyboard `EmojiCategory`: one page, padding 10 sideways and 6
/// on top, the (optional) title, and a grid with blank cells filling the
/// last row and room for the floating category bar (70) below.
class _EmojiCategoryPage extends StatelessWidget {
  const _EmojiCategoryPage({
    super.key,
    required this.category,
    required this.columns,
    required this.hideHeader,
    required this.bottomInset,
    required this.onPress,
    required this.onLongPress,
    required this.onScroll,
  });

  final EmojiCategoryData category;
  final int columns;
  final bool hideHeader;
  final double bottomInset;
  final ValueChanged<KeyboardEmoji> onPress;
  final void Function(KeyboardEmoji emoji, BuildContext cellContext) onLongPress;
  final VoidCallback onScroll;

  @override
  Widget build(BuildContext context) {
    final recents = RecentEmojis.recentlyUsed.value;
    final emojis = category.emojis;
    return Padding(
      padding: const EdgeInsets.only(left: 10, right: 10, top: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!hideHeader)
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 6, left: 12),
              child: Text(
                _categoryTitles[category.title] ?? category.title,
                style: const TextStyle(fontFamily: _systemFont, fontSize: 14, color: _Theme.header),
              ),
            ),
          if (emojis.isNotEmpty)
            Expanded(
              child: NotificationListener<ScrollUpdateNotification>(
                onNotification: (_) {
                  onScroll();
                  return false;
                },
                child: GridView.builder(
                  padding: EdgeInsets.only(bottom: 70 + bottomInset),
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: columns,
                    // SingleEmoji: padding 4 + wrapper padding 4 around a 28pt glyph.
                    mainAxisExtent: _emojiSize * 1.2 + 16,
                  ),
                  itemCount: emojis.length,
                  itemBuilder: (context, index) {
                    final emoji = emojis[index];
                    // A toned pick from Recently used replaces the base glyph.
                    final shown = recents.where((e) => e.name == emoji.name).firstOrNull ?? emoji;
                    return Builder(
                      builder: (cellContext) => GestureDetector(
                        key: ValueKey('emoji-${category.title}-${emoji.name}'),
                        behavior: HitTestBehavior.opaque,
                        onTap: () => onPress(shown),
                        onLongPress: () => onLongPress(shown, cellContext),
                        child: Center(
                          child: Text(
                            shown.emoji,
                            style: const TextStyle(fontSize: _emojiSize, color: Colors.black),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// rn-emoji-keyboard `Categories` + `CategoryItem` (floating): a beige pill
/// (padding 3, radius 8) of 28pt icons split by hairlines, with a white
/// indicator that follows the page scroll.
class _CategoryBar extends StatelessWidget {
  const _CategoryBar({
    required this.titles,
    required this.activeIndex,
    required this.pageController,
    required this.onSelect,
  });

  final List<String> titles;
  final int activeIndex;
  final PageController pageController;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: _Theme.categoryContainer, borderRadius: BorderRadius.circular(8)),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Stack(
          children: [
            AnimatedBuilder(
              animation: pageController,
              builder: (context, _) {
                final page = pageController.hasClients && pageController.position.haveDimensions
                    ? (pageController.page ?? activeIndex.toDouble())
                    : activeIndex.toDouble();
                return Positioned(
                  left: page * _categoryElementWidth,
                  top: 0,
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: _Theme.categoryContainerActive,
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                );
              },
            ),
            Row(
              children: [
                for (var i = 0; i < titles.length; i++) ...[
                  if (i > 0)
                    Container(
                      width: 1,
                      height: 28,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      color: _Theme.hairline,
                    ),
                  GestureDetector(
                    key: ValueKey('emoji-category-${titles[i]}'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () => onSelect(i),
                    child: SizedBox(
                      width: 28,
                      height: 28,
                      child: Center(
                        child: _PngIcon(
                          kEmojiCategoryIcons[titles[i]] ?? 'questionMark',
                          color: i == activeIndex ? _Theme.categoryIconActive : _Theme.categoryIcon,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// rn-emoji-keyboard `SkinTones`: a 226x48 beige bar of the five tone
/// variants (32pt) just above the long-pressed emoji, with a small funnel
/// pointing at it.
class _SkinTones extends StatelessWidget {
  const _SkinTones({required this.data, required this.onPress});

  final _ToneData data;
  final ValueChanged<KeyboardEmoji> onPress;

  static const _width = 226.0;
  static const _height = 48.0;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final anchor = data.anchor;
        final left = (anchor.center.dx - _width / 2)
            .clamp(18.0, math.max(18.0, constraints.maxWidth - _width - 18))
            .toDouble();
        final top = math.max(0.0, anchor.top - _height - 7);
        return Stack(
          children: [
            Positioned(
              left: left,
              top: top,
              child: Container(
                key: const Key('emoji-skin-tones'),
                width: _width,
                height: _height,
                decoration: BoxDecoration(color: _Theme.skinTonesContainer, borderRadius: BorderRadius.circular(8)),
                // RN: a horizontal FlatList.
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (var i = 0; i < data.variants.length; i++) ...[
                        if (i > 0)
                          Container(
                            width: 1,
                            height: 38,
                            margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 5),
                            color: _Theme.hairline,
                          ),
                        GestureDetector(
                          key: ValueKey('emoji-tone-$i'),
                          onTap: () => onPress(data.variants[i]),
                          child: Text(
                            data.variants[i].emoji,
                            style: const TextStyle(fontSize: 32, color: Colors.black),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
            Positioned(
              left: anchor.center.dx - 7,
              top: top + _height - 1,
              child: CustomPaint(size: const Size(14, 8), painter: _FunnelPainter()),
            ),
          ],
        );
      },
    );
  }
}

class _FunnelPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = _Theme.skinTonesContainer);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
