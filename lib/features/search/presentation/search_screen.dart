import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/widgets/app_text_field.dart';
import '../data/search_repository.dart';

/// Port of ally-mobile (React Native)'s `SearchScreen` + `useSearch` hook —
/// category tabs built from the response's per-category counts ("All (12)",
/// "Anxiety (4)", ...) and infinite-scroll pagination via `excludedIds`,
/// same strategy as the RN screen (no offset param; each page excludes the
/// ids already shown). The RN screen's animated launch/suggestions UI
/// isn't ported — functional parity on tabs/pagination, not gesture-for-
/// gesture UI parity, same pattern as elsewhere in this port.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();

  String _lastSearchedText = '';
  String _selectedCategory = 'All';
  List<ResourceArticle> _resources = [];
  Map<String, int> _categoryCounts = {};
  int? _initialTotal;
  bool _hasMore = true;
  bool _isLoading = false;
  bool _isLoadingMore = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      _loadMore();
    }
  }

  Future<void> _search() async {
    final query = _controller.text.trim();
    if (query.isEmpty) return;
    setState(() {
      _lastSearchedText = query;
      _selectedCategory = 'All';
      _initialTotal = null;
      _isLoading = true;
      _error = null;
    });
    try {
      final result = await ref.read(searchRepositoryProvider).search(query);
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

  @override
  Widget build(BuildContext context) {
    final totalCount = _categoryCounts.values.fold(0, (a, b) => a + b);
    final tabs = [
      ('All', totalCount),
      for (final entry in _categoryCounts.entries) (entry.key, entry.value),
    ];

    return Scaffold(
      appBar: AppBar(
        title: AppTextField(
          controller: _controller,
          shape: AppTextFieldShape.line,
          placeholder: ref.t('search.placeholder'),
          onSubmitted: (_) => _search(),
        ),
        actions: [
          IconButton(
            icon: SvgPicture.asset('assets/icons/search.svg', width: 24, height: 24),
            onPressed: _search,
          ),
        ],
      ),
      body: Column(
        children: [
          if (_resources.isNotEmpty && tabs.length > 1)
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                children: [
                  for (final (category, count) in tabs)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
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
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
                    : _lastSearchedText.isEmpty
                        ? Center(child: Text(ref.t('search.headerDescription')))
                        : _resources.isEmpty
                            ? Center(
                                child: Text(ref.t('search.noResults', {'query': _lastSearchedText})),
                              )
                            : ListView.builder(
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
                                    subtitle: Text(
                                      article.content,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    trailing: Chip(label: Text(article.category)),
                                  );
                                },
                              ),
          ),
        ],
      ),
    );
  }
}
