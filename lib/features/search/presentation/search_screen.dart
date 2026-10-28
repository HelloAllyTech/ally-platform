import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/navigation/drawer_menu_button.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../data/search_repository.dart';
import 'resource_article_card.dart';

/// RN's `searchConfig.ts` `trySuggestions` — shown as the launch-screen
/// suggestion list, as the no-results empty-state suggestions, and as the
/// source list `filteredSuggestions` substring-matches while typing.
const _trySuggestions = ['Violence safety plan', 'Suicide assessment', 'Survivors of abuse', "Client's resistance"];

/// Port of ally-mobile (React Native)'s `SearchScreen` + `useSearch` hook.
/// Category tabs built from the response's per-category counts ("All (12)",
/// "Anxiety (4)", ...) and infinite-scroll pagination via `excludedIds`
/// (no offset param; each page excludes the ids already shown) already
/// matched RN's functional behavior; this pass adds the launch-screen UI
/// RN actually shows before any search: the centered logo + description,
/// the "Try now:" suggestion list (also shown in the no-results empty
/// state), and live substring-filtered autocomplete while typing.
///
/// Not ported: RN's `react-native-reanimated` slide/fade/height
/// interpolation when the search bar gains focus (the header description
/// collapsing, the search bar sliding up) — replaced with plain
/// show/hide, a reasonable simplification of micro-polish that doesn't
/// change what's reachable or how search behaves.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  final _scrollController = ScrollController();
  Timer? _debounce;

  String _lastSearchedText = '';

  /// RN `selectedCategory`: 'All', or a tab key (the category lowercased,
  /// which is also what RN sends as the filter).
  String _selectedCategory = 'All';
  List<ResourceArticle> _resources = [];
  Map<String, int> _categoryCounts = {};
  int? _initialTotal;
  bool _hasMore = true;

  /// RN `loading` (`isLoading || isFetching`): any search request in flight.
  bool _loading = false;

  /// RN `showSearchResults`: set by the first search and never unset, so
  /// Clear (X) stays on the results view.
  bool _showSearchResults = false;

  bool _focused = false;
  List<String> _filteredSuggestions = [];

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _focusNode.addListener(() => setState(() => _focused = _focusNode.hasFocus));
    _controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _scrollController.dispose();
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  // FlatList `onEndReachedThreshold: 0.5` (half a viewport from the end).
  void _onScroll() {
    final position = _scrollController.position;
    if (position.pixels >= position.maxScrollExtent - position.viewportDimension * 0.5) {
      _loadMore();
    }
  }

  // RN's `debounceSearch` — 250ms, re-filters `trySuggestions` by substring
  // match against whatever's currently typed; empty text clears it outright
  // rather than matching everything.
  void _onTextChanged() {
    _debounce?.cancel();
    final text = _controller.text.trim();
    if (text.isEmpty) {
      setState(() => _filteredSuggestions = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      setState(() {
        _filteredSuggestions = _trySuggestions.where((s) => s.toLowerCase().contains(text.toLowerCase())).toList();
      });
    });
  }

  /// RN `onSearch`.
  Future<void> _search([String? query]) async {
    final text = query ?? _controller.text;
    if (text.trim().isEmpty) return;
    if (query != null) _controller.text = query;
    _focusNode.unfocus();
    setState(() {
      _lastSearchedText = text;
      _selectedCategory = 'All';
      _initialTotal = null;
      _filteredSuggestions = [];
    });
    await _triggerSearch(text);
    if (mounted) setState(() => _showSearchResults = true);
  }

  /// RN `triggerSearch`: the previous results stay up (with the footer
  /// spinner) until the response replaces them; a failure is only logged.
  Future<void> _triggerSearch(String query, {String? category}) async {
    final filtered = category != null && category != 'All';
    if (_scrollController.hasClients) {
      unawaited(_scrollController.animateTo(0, duration: const Duration(milliseconds: 300), curve: Curves.easeOut));
    }
    setState(() => _loading = true);
    try {
      final result = await ref.read(searchRepositoryProvider).search(query, category: filtered ? category : null);
      if (!mounted) return;
      setState(() {
        _resources = result.documents;
        _initialTotal = result.total;
        _hasMore = result.total > result.documents.length;
        if (!filtered) _categoryCounts = result.categoryCounts;
      });
    } catch (_) {
      // RN: `logger.error` only.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// RN `handleTabChange` → `onCategoryChange`.
  Future<void> _selectTab(String key) async {
    final category = key == 'all' ? 'All' : key;
    setState(() => _selectedCategory = category);
    if (_lastSearchedText.isNotEmpty) await _triggerSearch(_lastSearchedText, category: category);
  }

  /// RN `fetchRemainingResources`.
  Future<void> _loadMore() async {
    if (_loading || !_hasMore || _lastSearchedText.isEmpty) return;
    setState(() => _loading = true);
    try {
      final result = await ref
          .read(searchRepositoryProvider)
          .search(
            _lastSearchedText,
            category: _selectedCategory == 'All' ? null : _selectedCategory,
            excludedIds: [for (final r in _resources) r.id],
          );
      if (!mounted) return;
      setState(() {
        _resources = [..._resources, ...result.documents];
        _hasMore = _initialTotal != null ? _initialTotal! > _resources.length : true;
      });
    } catch (_) {
      // Stays retryable on the next scroll tick, same as the RN hook.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// RN `resetSearch`: clears the query and results but leaves
  /// `showSearchResults` alone, so the results view stays, showing
  /// SearchEmpty's suggestions.
  void _resetSearch() {
    _debounce?.cancel();
    setState(() {
      _controller.clear();
      _lastSearchedText = '';
      _resources = [];
      _categoryCounts = {};
      _selectedCategory = 'All';
      _initialTotal = null;
      _hasMore = true;
      _filteredSuggestions = [];
    });
  }

  @override
  Widget build(BuildContext context) {
    // RN `tabsMeta`: "All (sum)" then each category, keyed lowercased.
    final totalCount = _categoryCounts.values.fold(0, (a, b) => a + b);
    final tabs = [
      ('all', '${ref.t('search.allLabel')} ($totalCount)'),
      for (final entry in _categoryCounts.entries) (entry.key.toLowerCase(), '${entry.key} (${entry.value})'),
    ];

    final searchBar = _SearchBar(
      controller: _controller,
      focusNode: _focusNode,
      onSubmitted: (_) => _search(),
      onClear: _resetSearch,
      showDropdown: _focused && _filteredSuggestions.isNotEmpty,
      suggestions: _filteredSuggestions,
      onSuggestionTap: _search,
    );

    return GestureDetector(
      // RN's `TouchableWithoutFeedback` wrapping both the launch and
      // results views — tapping anywhere outside the input/suggestions
      // dismisses the keyboard and the autocomplete dropdown.
      behavior: HitTestBehavior.translucent,
      onTap: () => _focusNode.unfocus(),
      child: Scaffold(
        backgroundColor: Colors.white,
        // RN's launch view isn't inset for the status bar (its 44@vs top
        // padding sits under it), so only the results view keeps the top
        // safe area.
        body: _showSearchResults
            ? SafeArea(child: _buildDetailSearch(tabs, searchBar))
            : SafeArea(top: false, child: _buildSearchLaunch(searchBar)),
      ),
    );
  }

  /// RN `renderSearchLaunch`: `styles.searchContainer` (paddingTop 44@vs,
  /// 24pt sides), `SearchHeader`, the search input, then — while unfocused —
  /// the "Try now:" label and left-aligned suggestion chips. Focusing slides
  /// the header up 60 and the input up 50 (unscaled) over 300ms, like RN's
  /// `titleAnimStyle`/`searchAnimStyle`.
  Widget _buildSearchLaunch(Widget searchBar) {
    final rn = RnSize.of(context);
    return TweenAnimationBuilder<double>(
      tween: Tween(end: _focused ? 1 : 0),
      duration: const Duration(milliseconds: 300),
      builder: (context, t, _) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // styles.searchContainer paddingTop 44@vs, from the top of the
            // screen (it used to sit below the status-bar inset, clamped,
            // which put the whole view ~5pt lower than RN).
            SizedBox(height: rn.vs(44)),
            Transform.translate(offset: Offset(0, rn.raw(-60) * t), child: const _SearchHeader()),
            Transform.translate(
              offset: Offset(0, rn.raw(-50) * t),
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: rn.mvs(10)),
                child: searchBar,
              ),
            ),
            if (!_focused) ...[
              // styles.tryContainer: marginVertical 10@vs; styles.tryLabel.
              Padding(
                padding: EdgeInsets.symmetric(vertical: rn.vs(10)),
                child: Text(
                  ref.t('search.suggestionsTitle'),
                  style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 16, color: Colors.black),
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.only(bottom: 100),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final suggestion in _trySuggestions)
                        // RN `<SearchIcon width={16} height={16} />`: unscaled.
                        _SuggestionChip(text: suggestion, iconSize: rn.raw(16), onTap: () => _search(suggestion)),
                    ],
                  ),
                ),
              ),
            ] else
              const Spacer(),
          ],
        ),
      ),
    );
  }

  /// RN `renderDetailSearch` (`styles.container`: 16pt sides).
  Widget _buildDetailSearch(List<(String, String)> tabs, Widget searchBar) {
    final rn = RnSize.of(context);
    final activeKey = _selectedCategory.toLowerCase();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          searchBar,
          if (_resources.isNotEmpty) _CategoryTabs(tabs: tabs, activeKey: activeKey, onTap: _selectTab),
          Expanded(
            child: _resources.isEmpty && _loading
                // RN `showInitialLoader`: a small indicator, 16vs margins.
                ? Align(
                    alignment: Alignment.topCenter,
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: rn.vs(16)),
                      child: const CircularProgressIndicator.adaptive(),
                    ),
                  )
                : _resources.isNotEmpty
                ? _buildResultsList(rn)
                : _buildEmpty(),
          ),
        ],
      ),
    );
  }

  /// RN's FlatList: `tabBody` (marginTop 6), `tabBodyContent`
  /// (paddingBottom 200), footer spinner while a request is in flight.
  Widget _buildResultsList(RnSize rn) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.only(bottom: 200),
        itemCount: _resources.length + (_loading ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= _resources.length) {
            return Padding(
              padding: EdgeInsets.symmetric(vertical: rn.vs(16)),
              child: const Center(child: CircularProgressIndicator.adaptive()),
            );
          }
          final article = _resources[index];
          return ResourceArticleCard(key: ValueKey('$_selectedCategory-${article.id}'), article: article);
        },
      ),
    );
  }

  /// RN `SearchEmpty` (light): 32@vs top/bottom, everything 16pt in; the
  /// "No results" line only when there was a query (not after Clear).
  Widget _buildEmpty() {
    final rn = RnSize.of(context);
    return SingleChildScrollView(
      padding: EdgeInsets.symmetric(vertical: rn.vs(32)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_lastSearchedText.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 16),
              child: Text(
                ref.t('search.noResults', {'query': _lastSearchedText}),
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 14,
                  height: 20 / 14,
                  color: AppColors.lightGray12,
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(left: 16, top: 18, bottom: 10),
            child: Text(
              ref.t('search.suggestionsTitle'),
              style: const TextStyle(
                fontFamily: AppFonts.ibmPlexSerifRegular,
                fontSize: 14,
                height: 20 / 14,
                color: Colors.black,
              ),
            ),
          ),
          for (final suggestion in _trySuggestions)
            Padding(
              padding: const EdgeInsets.only(left: 16),
              child: _SuggestionChip(text: suggestion, iconSize: 14, onTap: () => _search(suggestion)),
            ),
        ],
      ),
    );
  }
}

/// RN `components/CustomTabs` (light): a horizontally scrolling 38pt row
/// with a 1pt lightGray14 bottom border; each tab 36pt tall, 10 sides /
/// 3 bottom padding, IBM Plex Serif Medium body.small; the active one in
/// darkSlate w500 over a 2pt black underline, the rest lightGray3 w400.
class _CategoryTabs extends StatelessWidget {
  const _CategoryTabs({required this.tabs, required this.activeKey, required this.onTap});

  final List<(String, String)> tabs;
  final String activeKey;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 38,
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: AppColors.lightGray14)),
      ),
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final (key, title) in tabs)
            Semantics(
              selected: key == activeKey,
              button: true,
              child: GestureDetector(
                key: ValueKey('search-tab-$key'),
                behavior: HitTestBehavior.opaque,
                onTap: () => onTap(key),
                child: Container(
                  height: 36,
                  padding: const EdgeInsets.only(left: 10, right: 10, bottom: 3),
                  alignment: Alignment.bottomCenter,
                  decoration: key == activeKey
                      ? const BoxDecoration(
                          border: Border(bottom: BorderSide(color: Colors.black, width: 2)),
                        )
                      : null,
                  child: Text(
                    title,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 12,
                      height: 16 / 12,
                      letterSpacing: 0.2,
                      color: key == activeKey ? AppColors.darkSlate : AppColors.lightGray3,
                      fontWeight: key == activeKey ? FontWeight.w500 : FontWeight.w400,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// RN's `SearchHeader`: `marginTop: 80@mvs`, then a borderless
/// `TabScreenHeader` (marginTop 16, 12pt top/bottom padding) whose title is
/// empty and whose right content is the Ally logo + tagline. That content
/// box is `flex: 1` inside an auto-height column, so it collapses to zero
/// height: the header is only as tall as the empty title's 24pt line, the
/// logo overflows downward from its top (centred), and the
/// `search.headerDescription` tagline lands behind the search input, which
/// is drawn over it — so RN never shows it. This keeps the same height and
/// logo position and leaves the hidden tagline out.
class _SearchHeader extends StatelessWidget {
  const _SearchHeader();

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return Padding(
      padding: EdgeInsets.only(top: rn.mvs(80) + 16),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: SizedBox(
          height: 24,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: Center(child: SvgPicture.asset('assets/icons/allyLogo.svg')),
              ),
              // RN's `showHamburger` when Search is the first tab.
              if (DrawerMenuScope.showsMenu(context))
                const Align(alignment: Alignment.centerLeft, child: DrawerMenuButton()),
            ],
          ),
        ),
      ),
    );
  }
}

/// RN's `SearchInput` — a rounded search bar (icon, text field, clear
/// button once non-empty) with an inline autocomplete dropdown directly
/// below it while typing. RN overlays the dropdown absolutely on top of
/// whatever's beneath the search bar; this pushes it inline in the Column
/// instead — visually close, and avoids needing an `Overlay`/
/// `CompositedTransformFollower` for a dropdown this shallow (at most 4
/// rows, since it only ever filters the same static suggestion list).
class _SearchBar extends ConsumerWidget {
  const _SearchBar({
    required this.controller,
    required this.focusNode,
    required this.onSubmitted,
    required this.onClear,
    required this.showDropdown,
    required this.suggestions,
    required this.onSuggestionTap,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onSubmitted;
  final VoidCallback onClear;
  final bool showDropdown;
  final List<String> suggestions;
  final ValueChanged<String> onSuggestionTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // styles.searchBar: white, 0.5pt lightGray4 border, radius 20, 12pt
    // sides, capped at 40pt tall; 14pt SearchIcon in an 18pt box; 14pt
    // IBM Plex Serif input in darkSlate with a lightGray13 placeholder.
    // RN sizes its SVG icons with plain numbers, so those use [RnSize.raw].
    final rn = RnSize.of(context);
    return Column(
      children: [
        Container(
          key: const Key('search-bar'),
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: AppColors.lightGray4, width: 0.5),
            borderRadius: showDropdown
                ? const BorderRadius.vertical(top: Radius.circular(20))
                : BorderRadius.circular(20),
          ),
          child: Row(
            children: [
              SizedBox(
                width: 18,
                height: 18,
                child: Center(
                  child: SizedBox.square(dimension: rn.raw(14), child: SvgPicture.asset('assets/icons/search.svg')),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: controller,
                  focusNode: focusNode,
                  onSubmitted: onSubmitted,
                  cursorColor: AppColors.darkSlate,
                  decoration: InputDecoration(
                    hintText: ref.t('nav.tabs.search'),
                    hintStyle: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifRegular,
                      fontSize: 14,
                      color: AppColors.lightGray13,
                    ),
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    filled: false,
                    isDense: true,
                    contentPadding: EdgeInsets.zero,
                  ),
                  style: const TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifRegular,
                    fontSize: 14,
                    color: AppColors.darkSlate,
                  ),
                ),
              ),
              if (controller.text.isNotEmpty)
                GestureDetector(
                  key: const Key('search-clear'),
                  onTap: onClear,
                  child: Container(
                    width: 18,
                    height: 18,
                    margin: const EdgeInsets.only(left: 8),
                    alignment: Alignment.center,
                    child: SizedBox(
                      width: rn.raw(16),
                      height: rn.raw(16),
                      child: SvgPicture.asset(
                        'assets/icons/close.svg',
                        colorFilter: const ColorFilter.mode(Colors.black, BlendMode.srcIn),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (showDropdown)
          Container(
            width: double.infinity,
            // styles.suggestionsWrapper: paddingBottom 8@vs.
            padding: EdgeInsets.only(bottom: rn.vs(8)),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: AppColors.lightGray4, width: 0.5),
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(12)),
            ),
            child: Column(
              children: [
                for (final suggestion in suggestions)
                  GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => onSuggestionTap(suggestion),
                    child: Padding(
                      // styles.suggestionRow (16@s / 10@vs), an unscaled
                      // 16pt SearchIcon, suggestionText marginLeft 12@s.
                      padding: EdgeInsets.symmetric(horizontal: rn.s(16), vertical: rn.vs(10)),
                      child: Row(
                        children: [
                          SizedBox.square(dimension: rn.raw(16), child: SvgPicture.asset('assets/icons/search.svg')),
                          SizedBox(width: rn.s(12)),
                          Expanded(
                            child: Text(
                              suggestion,
                              style: const TextStyle(
                                fontFamily: AppFonts.ibmPlexSerifRegular,
                                fontSize: 16,
                                color: AppColors.gray99,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// RN's `SearchSuggestion` chip: left-aligned (`alignSelf: 'flex-start'`),
/// 0.5pt lightGray14 border, radius 8, 7@mvs/8 padding, 14@mvs below,
/// SearchIcon then 14/18 gray99 text up to 3 lines.
class _SuggestionChip extends StatelessWidget {
  const _SuggestionChip({required this.text, required this.iconSize, required this.onTap});

  final String text;
  final double iconSize;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        margin: EdgeInsets.only(bottom: rn.mvs(14)),
        padding: EdgeInsets.symmetric(horizontal: 8, vertical: rn.mvs(7)),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.lightGray14, width: rn.raw(0.5)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(width: iconSize, height: iconSize, child: SvgPicture.asset('assets/icons/search.svg')),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                text,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 14,
                  height: 18 / 14,
                  color: AppColors.gray99,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
