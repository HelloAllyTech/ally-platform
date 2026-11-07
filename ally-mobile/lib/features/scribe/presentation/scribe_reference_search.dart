import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/rn_scale.dart';
import '../../search/data/search_repository.dart';

/// RN `screens/SearchScreen/searchConfig.ts` `trySuggestions` (English
/// literals in RN too).
const scribeSearchSuggestions = <String>[
  'Violence safety plan',
  'Suicide assessment',
  'Survivors of abuse',
  "Client's resistance",
];

/// Port of RN `ListeningScreen/components/Search` + `hooks/useSearch`: the
/// dark reference-document search under the waveform in Scribe's and
/// Conference's non-focus mode. Idle it shows the search bar and the "Try
/// now:" suggestions; a search (`POST /reference-document/search`, 6 at a
/// time, `excludedIds` paging on scroll) shows category tabs with counts,
/// dark `ResourceArticleCard`s, or `SearchEmpty`.
class ScribeReferenceSearch extends ConsumerStatefulWidget {
  const ScribeReferenceSearch({super.key});

  @override
  ConsumerState<ScribeReferenceSearch> createState() => _ScribeReferenceSearchState();
}

class _ScribeReferenceSearchState extends ConsumerState<ScribeReferenceSearch> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  final _scrollController = ScrollController();

  bool _showSearchResults = false;
  String _lastSearchedText = '';
  String _selectedCategory = 'All';
  List<ResourceArticle> _resources = const [];
  Map<String, int> _categoryCounts = const {};
  int? _initialTotal;
  bool _hasMore = true;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(() => setState(() {}));
    _controller.addListener(() => setState(() {}));
    _scrollController.addListener(() {
      final position = _scrollController.position;
      if (position.pixels >= position.maxScrollExtent * 0.5) _loadMore();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  SearchRepository get _repository => ref.read(searchRepositoryProvider);

  /// RN `triggerSearch`: the first page for [query]/[category]; the
  /// category counts only refresh for "All".
  Future<void> _triggerSearch(String query, {String? category}) async {
    if (_scrollController.hasClients) _scrollController.jumpTo(0);
    setState(() => _loading = true);
    try {
      final result = await _repository.search(query, category: category);
      if (!mounted) return;
      setState(() {
        _resources = result.documents;
        _initialTotal = result.total;
        _hasMore = result.total > result.documents.length;
        if (category == null || category == 'All') _categoryCounts = result.categoryCounts;
      });
    } catch (error) {
      debugPrint('Error fetching search results: $error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// RN `onSearch`.
  Future<void> _onSearch(String query) async {
    _controller.text = query;
    setState(() {
      _lastSearchedText = query;
      _selectedCategory = 'All';
      _initialTotal = null;
    });
    if (query.trim().isEmpty) return;
    _focusNode.unfocus();
    setState(() => _showSearchResults = true);
    await _triggerSearch(query);
  }

  /// RN `fetchRemainingResources`.
  Future<void> _loadMore() async {
    if (_loading || !_hasMore || _lastSearchedText.isEmpty) return;
    setState(() => _loading = true);
    try {
      final result = await _repository.search(
        _lastSearchedText,
        category: _selectedCategory,
        excludedIds: [for (final r in _resources) r.id],
      );
      if (!mounted) return;
      setState(() {
        final loaded = _resources.length + result.documents.length;
        _resources = [..._resources, ...result.documents];
        _hasMore = _initialTotal != null ? _initialTotal! > loaded : true;
      });
    } catch (error) {
      debugPrint('Error fetching remaining resources: $error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// RN `handleTabChange` → `onCategoryChange(tab.key)` (the lower-cased
  /// key is what RN sends as the filter).
  Future<void> _onTab(String key) async {
    final category = key == 'all' ? 'All' : key;
    setState(() => _selectedCategory = category);
    if (_lastSearchedText.isNotEmpty) await _triggerSearch(_lastSearchedText, category: category);
  }

  /// RN `resetSearch` (the clear button) — results stay open, emptied.
  void _resetSearch() {
    _controller.clear();
    setState(() {
      _lastSearchedText = '';
      _resources = const [];
      _categoryCounts = const {};
      _selectedCategory = 'All';
      _initialTotal = null;
      _hasMore = true;
    });
  }

  List<(String key, String title)> get _tabs => [
        ('all', 'All (${_categoryCounts.values.fold<int>(0, (a, b) => a + b)})'),
        for (final entry in _categoryCounts.entries) (entry.key.toLowerCase(), '${entry.key} (${entry.value})'),
      ];

  Widget _searchInput(RnSize rn) {
    final focusedIdle = _focusNode.hasFocus && !_showSearchResults;
    final bar = Container(
      constraints: const BoxConstraints(maxHeight: 40),
      margin: EdgeInsets.only(top: focusedIdle ? rn.mvs(4) : 0),
      padding: EdgeInsets.symmetric(vertical: rn.mvs(8), horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.darkGray5,
        borderRadius: BorderRadius.circular(focusedIdle ? 12 : 8),
        border: focusedIdle ? null : Border.all(color: AppColors.darkGray11, width: 0.5),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 18,
            height: 18,
            child: Center(
              child: SvgPicture.asset(
                'assets/icons/searchActive.svg',
                width: 14,
                height: 14,
                colorFilter: const ColorFilter.mode(AppColors.darkGray8, BlendMode.srcIn),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              key: const Key('scribe-search-input'),
              controller: _controller,
              focusNode: _focusNode,
              textInputAction: TextInputAction.search,
              onSubmitted: (text) {
                if (text.trim().isNotEmpty) _onSearch(text);
              },
              style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14, color: Colors.white),
              cursorColor: Colors.white,
              decoration: InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                hintText: ref.t('nav.tabs.search'),
                hintStyle: const TextStyle(
                  fontFamily: AppFonts.ibmPlexSerifRegular,
                  fontSize: 14,
                  color: AppColors.darkGray8,
                ),
              ),
            ),
          ),
          if (_controller.text.isNotEmpty)
            GestureDetector(
              key: const Key('scribe-search-clear'),
              onTap: _resetSearch,
              child: Padding(
                padding: const EdgeInsets.only(left: 8),
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: Center(
                    child: SizedBox(
                      width: 16,
                      height: 16,
                      child: SvgPicture.asset(
                        'assets/icons/close.svg',
                        colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
    if (!focusedIdle) return bar;
    // RN `baseContainer` around the focused, idle bar.
    return Container(
      decoration: BoxDecoration(
        color: AppColors.darkGray5,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.darkGray11, width: 0.5),
      ),
      child: bar,
    );
  }

  Widget _suggestion(RnSize rn, String text, {double iconSize = 16}) {
    return GestureDetector(
      key: ValueKey('scribe-search-suggestion-$text'),
      onTap: () => _onSearch(text),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Container(
          margin: EdgeInsets.only(bottom: rn.mvs(14)),
          padding: EdgeInsets.symmetric(vertical: rn.mvs(7), horizontal: 8),
          decoration: BoxDecoration(
            color: AppColors.darkGray5,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.darkGray4, width: 0.5),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: iconSize,
                height: iconSize,
                child: SvgPicture.asset(
                  'assets/icons/searchActive.svg',
                  colorFilter: const ColorFilter.mode(AppColors.darkGray8, BlendMode.srcIn),
                ),
              ),
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
      ),
    );
  }

  /// RN `SearchEmpty` (dark).
  Widget _empty(RnSize rn) {
    const body = TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14, height: 20 / 14);
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
                style: body.copyWith(color: AppColors.gray99),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(left: 16, top: 18, bottom: 10),
            child: Text(ref.t('search.suggestionsTitle'), style: body.copyWith(color: Colors.white)),
          ),
          for (final text in scribeSearchSuggestions)
            Padding(padding: const EdgeInsets.only(left: 16), child: _suggestion(rn, text, iconSize: 14)),
        ],
      ),
    );
  }

  /// RN `CustomTabs` with `colorScheme="dark"`.
  Widget _tabBar() {
    final activeKey = _selectedCategory.toLowerCase();
    return Container(
      height: 38,
      decoration: const BoxDecoration(
        color: AppColors.darkGray7,
        border: Border(bottom: BorderSide(color: AppColors.darkGray9)),
      ),
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final (key, title) in _tabs)
            GestureDetector(
              key: ValueKey('scribe-search-tab-$key'),
              onTap: () => _onTab(key),
              child: Container(
                height: 36,
                padding: const EdgeInsets.only(left: 10, right: 10, bottom: 3),
                alignment: Alignment.bottomCenter,
                decoration: key == activeKey
                    ? const BoxDecoration(border: Border(bottom: BorderSide(color: Colors.white, width: 2)))
                    : null,
                child: Text(
                  title,
                  style: TextStyle(
                    fontFamily: AppFonts.ibmPlexSerifMedium,
                    fontSize: 12,
                    height: 16 / 12,
                    letterSpacing: 0.2,
                    color: AppColors.lightGray15,
                    fontWeight: key == activeKey ? FontWeight.w500 : FontWeight.w400,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _results(RnSize rn) {
    final showInitialLoader = _resources.isEmpty && _loading;
    return Column(
      children: [
        _searchInput(rn),
        if (_resources.isNotEmpty && _tabs.isNotEmpty) _tabBar(),
        Expanded(
          child: showInitialLoader
              ? Align(
                  alignment: Alignment.topCenter,
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: rn.vs(16)),
                    child: const CircularProgressIndicator.adaptive(),
                  ),
                )
              : _resources.isNotEmpty
              ? Container(
                  color: AppColors.darkGray7,
                  margin: const EdgeInsets.only(top: 6),
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
                      return DarkResourceArticleCard(article: _resources[index]);
                    },
                  ),
                )
              : _empty(rn),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    return Padding(
      padding: EdgeInsets.only(top: rn.mvs(14)),
      child: _showSearchResults
          ? _results(rn)
          : GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: () => _focusNode.unfocus(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _searchInput(rn),
                  Flexible(
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxHeight: rn.vs(500)),
                      child: SingleChildScrollView(
                        child: LayoutBuilder(
                          builder: (context, constraints) => Padding(
                            padding: EdgeInsets.only(top: rn.mvs(80), left: constraints.maxWidth * 0.1),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Padding(
                                  padding: EdgeInsets.only(bottom: rn.mvs(10)),
                                  child: Text(
                                    ref.t('search.suggestionsTitle'),
                                    style: const TextStyle(
                                      fontFamily: AppFonts.ibmPlexSerifRegular,
                                      fontSize: 16,
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                                for (final text in scribeSearchSuggestions) _suggestion(rn, text),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

/// Port of RN `components/ResourceArticleCard` with `colorTheme="dark"`:
/// category chip and tag chips, the heading, and the content clamped to 3
/// lines with "View more" until tapped open.
class DarkResourceArticleCard extends ConsumerStatefulWidget {
  const DarkResourceArticleCard({super.key, required this.article});

  final ResourceArticle article;

  @override
  ConsumerState<DarkResourceArticleCard> createState() => _DarkResourceArticleCardState();
}

class _DarkResourceArticleCardState extends ConsumerState<DarkResourceArticleCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final rn = RnSize.of(context);
    final article = widget.article;
    const content = TextStyle(
      fontFamily: AppFonts.ibmPlexSerifRegular,
      fontSize: 14,
      height: 18 / 14,
      color: AppColors.white2,
    );
    return Container(
      margin: EdgeInsets.symmetric(vertical: rn.vs(6)),
      padding: EdgeInsets.symmetric(vertical: rn.vs(10)),
      decoration: BoxDecoration(
        color: AppColors.darkGray5,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.darkGray5, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: EdgeInsets.only(bottom: rn.vs(12)),
            child: Row(
              children: [
                Container(
                  height: 24,
                  margin: EdgeInsets.only(left: rn.s(10), right: rn.s(8)),
                  padding: EdgeInsets.symmetric(horizontal: rn.s(12), vertical: rn.vs(3)),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: AppColors.white3, borderRadius: BorderRadius.circular(16)),
                  child: Text(
                    article.category,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 12,
                      height: 16 / 12,
                      color: AppColors.darkGray5,
                    ),
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (final tag in article.tags)
                          Container(
                            margin: EdgeInsets.only(left: rn.s(8)),
                            padding: EdgeInsets.symmetric(horizontal: rn.s(12), vertical: rn.mvs(2)),
                            decoration: BoxDecoration(
                              color: AppColors.darkGray10,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: AppColors.darkGray10, width: 0.5),
                            ),
                            child: Text(
                              tag,
                              style: TextStyle(
                                fontFamily: AppFonts.ibmPlexSerifRegular,
                                fontSize: 12,
                                height: rn.mvs(20) / 12,
                                color: AppColors.white2,
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
          Padding(
            padding: EdgeInsets.symmetric(horizontal: rn.s(10)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: EdgeInsets.only(bottom: rn.vs(8)),
                  child: Text(
                    article.heading,
                    style: const TextStyle(
                      fontFamily: AppFonts.ibmPlexSerifMedium,
                      fontSize: 16,
                      height: 18 / 16,
                      color: Colors.white,
                    ),
                  ),
                ),
                GestureDetector(
                  onTap: () => setState(() => _expanded = !_expanded),
                  child: AnimatedSize(
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeInOut,
                    alignment: Alignment.topCenter,
                    child: _expanded
                        ? Text(article.content, style: content)
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(article.content, maxLines: 3, overflow: TextOverflow.ellipsis, style: content),
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      ref.t('common.viewMore'),
                                      style: const TextStyle(
                                        fontFamily: AppFonts.ibmPlexSerifRegular,
                                        fontSize: 13,
                                        height: 18 / 13,
                                        color: AppColors.white2,
                                      ),
                                    ),
                                    SvgPicture.asset(
                                      'assets/icons/downArrow.svg',
                                      width: 24,
                                      height: 24,
                                      colorFilter: const ColorFilter.mode(AppColors.white2, BlendMode.srcIn),
                                    ),
                                  ],
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
      ),
    );
  }
}
