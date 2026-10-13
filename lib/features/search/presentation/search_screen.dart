import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/search_repository.dart';

/// Scoped port of ally-mobile (React Native)'s `SearchScreen` — a search
/// field and flat result list. Category tabs/pagination not ported (see
/// repository's doc comment).
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _controller = TextEditingController();
  List<ResourceArticle>? _results;
  bool _isSearching = false;
  String? _error;

  Future<void> _search() async {
    final query = _controller.text.trim();
    if (query.isEmpty) return;
    setState(() {
      _isSearching = true;
      _error = null;
    });
    try {
      final results = await ref.read(searchRepositoryProvider).search(query);
      setState(() => _results = results);
    } catch (e) {
      setState(() => _error = 'Search failed: $e');
    } finally {
      if (mounted) setState(() => _isSearching = false);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _controller,
          decoration: const InputDecoration(hintText: 'Search resources...'),
          onSubmitted: (_) => _search(),
        ),
        actions: [IconButton(icon: const Icon(Icons.search), onPressed: _search)],
      ),
      body: _isSearching
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
              : _results == null
                  ? const Center(child: Text('Search for counselling resources.'))
                  : _results!.isEmpty
                      ? const Center(child: Text('No results found.'))
                      : ListView.builder(
                          itemCount: _results!.length,
                          itemBuilder: (context, index) {
                            final article = _results![index];
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
    );
  }
}
