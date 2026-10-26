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

    return GestureDetector(
      // RN's `TouchableWithoutFeedback` wrapping both the launch and
      // results views — tapping anywhere outside the input/suggestions
      // dismisses the keyboard and the autocomplete dropdown.
      behavior: HitTestBehavior.translucent,
      onTap: () => _focusNode.unfocus(),
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              children: [
                if (!showingResults) ...[
                  const SizedBox(height: 24),
                  _LogoHeader(showDescription: !_focused),
                ],
                _SearchBar(
                  controller: _controller,
                  focusNode: _focusNode,
                  onSubmitted: (_) => _search(),
                  onClear: _resetSearch,
                  showDropdown: _focused && _filteredSuggestions.isNotEmpty,
                  suggestions: _filteredSuggestions,
                  onSuggestionTap: _search,
                ),
                if (!showingResults && !_focused) ...[
                  const SizedBox(height: 18),
                  _TrySuggestions(onTap: _search),
                ],
                if (showingResults) ...[
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
                                label: Text(
                                  '${category == 'All' ? ref.t('search.allLabel') : category} ($count)',
                                ),
                                selected: _selectedCategory == category,
                                onSelected: (_) => _selectCategory(category),
                              ),
                            ),
                        ],
                      ),
                    ),
                  Expanded(child: _buildResultsBody()),
                ] else
                  const Spacer(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildResultsBody() {
    if (_isLoading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(child: Text(_error!, style: const TextStyle(color: Colors.red)));
    }
    if (_resources.isEmpty) {
      return SingleChildScrollView(
        padding: const EdgeInsets.symmetric(vertical: 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              ref.t('search.noResults', {'query': _lastSearchedText}),
              style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14),
            ),
            const SizedBox(height: 18),
            _TrySuggestions(onTap: _search),
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

/// RN's `SearchHeader` — centered Ally logo, with a description line that
/// collapses away once the search bar is focused.
class _LogoHeader extends ConsumerWidget {
  const _LogoHeader({required this.showDescription});

  final bool showDescription;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final logo = SvgPicture.asset('assets/icons/allyLogo.svg', height: 32);
    return Column(
      children: [
        // RN's `SearchHeader` also takes `showHamburger` — the logo stays
        // centred, with the button pinned left, when Search is the first tab.
        if (DrawerMenuScope.showsMenu(context))
          Stack(
            alignment: Alignment.center,
            children: [
              logo,
              const Align(alignment: Alignment.centerLeft, child: DrawerMenuButton()),
            ],
          )
        else
          logo,
        if (showDescription) ...[
          const SizedBox(height: 10),
          Text(
            ref.t('search.headerDescription'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: AppFonts.ibmPlexSerifRegular,
              fontSize: 14,
              color: AppColors.highEmphasis,
            ),
          ),
        ],
      ],
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
    return Column(
      children: [
        Container(
          margin: const EdgeInsets.symmetric(vertical: 10),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: AppColors.lightGray2, width: 0.5),
            borderRadius: showDropdown
                ? const BorderRadius.vertical(top: Radius.circular(20))
                : BorderRadius.circular(20),
          ),
          child: Row(
            children: [
              SvgPicture.asset('assets/icons/search.svg', width: 18, height: 18),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: controller,
                  focusNode: focusNode,
                  onSubmitted: onSubmitted,
                  decoration: InputDecoration(
                    hintText: ref.t('nav.tabs.search'),
                    border: InputBorder.none,
                    isDense: true,
                  ),
                  style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14),
                ),
              ),
              if (controller.text.isNotEmpty)
                GestureDetector(
                  onTap: onClear,
                  child: const Icon(Icons.close, size: 16, color: AppColors.highEmphasis),
                ),
            ],
          ),
        ),
        if (showDropdown)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(top: 0),
            padding: const EdgeInsets.only(bottom: 8),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: AppColors.lightGray2, width: 0.5),
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(12)),
            ),
            child: Column(
              children: [
                for (final suggestion in suggestions)
                  InkWell(
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
                                color: AppColors.mediumEmphasis,
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

/// RN's "Try now:" label + suggestion rows — shown both on the idle launch
/// screen (`renderSearchLaunch`) and below the no-results text in the
/// empty state (`SearchEmpty`), same list and same row styling in both.
class _TrySuggestions extends ConsumerWidget {
  const _TrySuggestions({required this.onTap});

  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          ref.t('search.suggestionsTitle'),
          style: const TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14),
        ),
        const SizedBox(height: 10),
        for (final suggestion in _trySuggestions)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: InkWell(
              onTap: () => onTap(suggestion),
              borderRadius: BorderRadius.circular(8),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.lightGray14, width: 0.5),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SvgPicture.asset('assets/icons/search.svg', width: 14, height: 14),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        suggestion,
                        maxLines: 3,
                        style: const TextStyle(
                          fontFamily: AppFonts.ibmPlexSerifRegular,
                          fontSize: 14,
                          color: AppColors.mediumEmphasis,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
