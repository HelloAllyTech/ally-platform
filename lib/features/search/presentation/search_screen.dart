import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/navigation/drawer_menu_button.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../data/search_repository.dart';

/// RN's `searchConfig.ts` `trySuggestions` — shown as the launch-screen
/// suggestion list, as the no-results empty-state suggestions, and as the
/// source list `filteredSuggestions` substring-matches while typing.
const _trySuggestions = [
  'Violence safety plan',
  'Suicide assessment',
  'Survivors of abuse',
  "Client's resistance",
];

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
  String _selectedCategory = 'All';
  List<ResourceArticle> _resources = [];
  Map<String, int> _categoryCounts = {};
  int? _initialTotal;
  bool _hasMore = true;
  bool _isLoading = false;
  bool _isLoadingMore = false;
  String? _error;

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

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
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
        _filteredSuggestions = _trySuggestions
            .where((s) => s.toLowerCase().contains(text.toLowerCase()))
            .toList();
      });
    });
  }

  Future<void> _search([String? query]) async {
    final text = (query ?? _controller.text).trim();
    if (text.isEmpty) return;
    if (query != null) _controller.text = query;
    _focusNode.unfocus();
    setState(() {
      _lastSearchedText = text;
      _selectedCategory = 'All';
      _initialTotal = null;
      _filteredSuggestions = [];
      _isLoading = true;
      _error = null;
    });
    try {
      final result = await ref.read(searchRepositoryProvider).search(text);
      setState(() {
        _resources = result.documents;
        _categoryCounts = result.categoryCounts;
        _initialTotal = result.total;
        _hasMore = result.total > result.documents.length;
      });
    } catch (e) {
      setState(() => _error = '${ref.tr('search.error')}: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _selectCategory(String category) async {
    if (category == _selectedCategory || _lastSearchedText.isEmpty) return;
    setState(() {
      _selectedCategory = category;
      _initialTotal = null;
      _isLoading = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(searchRepositoryProvider)
          .search(_lastSearchedText, category: category);
      setState(() {
        _resources = result.documents;
        _initialTotal = result.total;
        _hasMore = result.total > result.documents.length;
      });
    } catch (e) {
      setState(() => _error = '${ref.tr('search.error')}: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _loadMore() async {
    if (_isLoading || _isLoadingMore || !_hasMore || _lastSearchedText.isEmpty) return;
    setState(() => _isLoadingMore = true);
    try {
      final result = await ref.read(searchRepositoryProvider).search(
            _lastSearchedText,
            category: _selectedCategory,
            excludedIds: [for (final r in _resources) r.id],
          );
      setState(() {
        _resources = [..._resources, ...result.documents];
        _hasMore = _initialTotal != null ? _initialTotal! > _resources.length : true;
      });
    } catch (_) {
      // Stays retryable on the next scroll tick, same as the RN hook.
    } finally {
      if (mounted) setState(() => _isLoadingMore = false);
    }
  }

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
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final totalCount = _categoryCounts.values.fold(0, (a, b) => a + b);
    final tabs = [
      ('All', totalCount),
      for (final entry in _categoryCounts.entries) (entry.key, entry.value),
    ];
    final showingResults = _lastSearchedText.isNotEmpty;

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
        body: SafeArea(
          child: showingResults ? _buildDetailSearch(tabs, searchBar) : _buildSearchLaunch(searchBar),
        ),
      ),
    );
  }

  /// RN `renderSearchLaunch`: `styles.searchContainer` (paddingTop 44@vs,
  /// 24pt sides), `SearchHeader`, the search input, then — while unfocused —
  /// the "Try now:" label and left-aligned suggestion chips. Focusing slides
  /// the header up 60 and the input up 50 over 300ms, like RN's
  /// `titleAnimStyle`/`searchAnimStyle`.
  Widget _buildSearchLaunch(Widget searchBar) {
    final rn = _RnVerticalScale.of(context);
    return TweenAnimationBuilder<double>(
      tween: Tween(end: _focused ? 1 : 0),
      duration: const Duration(milliseconds: 300),
      builder: (context, t, _) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // RN's screen isn't inset for the status bar; this one is, so
            // take the inset back out of RN's top spacing.
            SizedBox(height: (rn.vs(44) - rn.statusBarTop).clamp(0, double.infinity)),
            Transform.translate(offset: Offset(0, -60 * t), child: const _SearchHeader()),
            Transform.translate(
              offset: Offset(0, -50 * t),
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
                        _SuggestionChip(text: suggestion, iconSize: 16, onTap: () => _search(suggestion)),
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
  Widget _buildDetailSearch(List<(String, int)> tabs, Widget searchBar) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        children: [
          searchBar,
          if (tabs.length > 1 && _resources.isNotEmpty)
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(vertical: 4),
                children: [
                  for (final (category, count) in tabs)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text('${category == 'All' ? ref.t('search.allLabel') : category} ($count)'),
                        selected: _selectedCategory == category,
                        onSelected: (_) => _selectCategory(category),
                      ),
                    ),
                ],
              ),
            ),
          Expanded(child: _buildResultsBody()),
        ],
      ),
    );
  }

  Widget _buildResultsBody() {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(child: Text(_error!, style: const TextStyle(color: Colors.red)));
    }
    if (_resources.isEmpty) {
      // RN `SearchEmpty`: 32@vs top/bottom, everything 16pt in.
      final rn = _RnVerticalScale.of(context);
      return SingleChildScrollView(
        padding: EdgeInsets.symmetric(vertical: rn.vs(32)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
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
    return ListView.builder(
      controller: _scrollController,
      itemCount: _resources.length + (_isLoadingMore ? 1 : 0),
      itemBuilder: (context, index) {
        if (index >= _resources.length) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          );
        }
        final article = _resources[index];
        return ListTile(
          title: Text(article.heading),
          subtitle: Text(article.content, maxLines: 2, overflow: TextOverflow.ellipsis),
          trailing: Chip(label: Text(article.category)),
        );
      },
    );
  }
}

/// react-native-size-matters' `verticalScale`/`moderateVerticalScale` in
/// this app's units. RN uses them (`@vs`/`@mvs`) for this screen's vertical
/// spacing; they scale with screen *height* (680pt guideline) rather than
/// width, so they can't be written as raw numbers under [RnScale] like
/// `@ms` values.
class _RnVerticalScale {
  _RnVerticalScale({required this.logicalHeight, required this.factor, required this.statusBarTop});

  factory _RnVerticalScale.of(BuildContext context) {
    final view = View.of(context);
    // RnScale multiplies devicePixelRatio by its factor; 1 without it.
    final factor = MediaQuery.devicePixelRatioOf(context) / view.devicePixelRatio;
    return _RnVerticalScale(
      logicalHeight: MediaQuery.sizeOf(context).height,
      factor: factor,
      statusBarTop: MediaQueryData.fromView(view).padding.top / factor,
    );
  }

  final double logicalHeight;
  final double factor;
  final double statusBarTop;

  double vs(double size) => size * logicalHeight / 680;
  double mvs(double size) => 0.5 * size / factor + 0.5 * vs(size);
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
    final rn = _RnVerticalScale.of(context);
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
    return Column(
      children: [
        Container(
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
                child: Center(child: SvgPicture.asset('assets/icons/search.svg', width: 14, height: 14)),
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
                  onTap: onClear,
                  child: Container(
                    width: 18,
                    height: 18,
                    margin: const EdgeInsets.only(left: 8),
                    alignment: Alignment.center,
                    child: SvgPicture.asset(
                      'assets/icons/close.svg',
                      width: 16,
                      height: 16,
                      colorFilter: const ColorFilter.mode(Colors.black, BlendMode.srcIn),
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (showDropdown)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.only(bottom: 8),
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
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      child: Row(
                        children: [
                          SvgPicture.asset('assets/icons/search.svg', width: 16, height: 16),
                          const SizedBox(width: 12),
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
    final rn = _RnVerticalScale.of(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        margin: EdgeInsets.only(bottom: rn.mvs(14)),
        padding: EdgeInsets.symmetric(horizontal: 8, vertical: rn.mvs(7)),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: AppColors.lightGray14, width: 0.5),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SvgPicture.asset('assets/icons/search.svg', width: iconSize, height: iconSize),
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
