import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../core/localization/translate_ref.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../data/places_repository.dart';

/// Port of RN `components/SearchableLocationDropdown`: the call summary's
/// Location picker. The closed header shows the value (or the
/// "Select location" placeholder at 50%) with a 6x6 chevron; tapping opens
/// a floating card under it with an autofocused search box. With no query
/// it lists `/places` 50 at a time (more load as the list nears its end);
/// typing searches `/places/search` after 300ms. Picking a place stores
/// "City, State".
class SearchableLocationDropdown extends ConsumerStatefulWidget {
  const SearchableLocationDropdown({super.key, required this.value, required this.onSelect, this.disabled = false});

  final String value;
  final ValueChanged<String> onSelect;
  final bool disabled;

  @override
  ConsumerState<SearchableLocationDropdown> createState() => _SearchableLocationDropdownState();
}

class _SearchableLocationDropdownState extends ConsumerState<SearchableLocationDropdown> {
  final _headerKey = GlobalKey();
  bool _isOpen = false;

  static const _valueStyle = TextStyle(
    fontFamily: AppFonts.ibmPlexSerifRegular,
    fontSize: 14,
    height: 22 / 14,
    letterSpacing: 0.2,
    color: AppColors.mediumEmphasis,
  );

  Future<void> _open() async {
    if (widget.disabled) return;
    final box = _headerKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null) return;
    final rect = box.localToGlobal(Offset.zero) & box.size;
    setState(() => _isOpen = true);
    final selected = await showGeneralDialog<String>(
      context: context,
      barrierDismissible: true,
      barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
      barrierColor: Colors.transparent,
      transitionDuration: Duration.zero,
      pageBuilder: (_, _, _) => _PlacesPopup(anchor: rect),
    );
    if (!mounted) return;
    setState(() => _isOpen = false);
    if (selected != null) widget.onSelect(selected);
  }

  @override
  Widget build(BuildContext context) {
    final hasValue = widget.value.isNotEmpty;
    return Opacity(
      opacity: widget.disabled ? 0.5 : 1,
      child: GestureDetector(
        key: _headerKey,
        behavior: HitTestBehavior.opaque,
        onTap: _open,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(4)),
          child: Row(
            children: [
              Flexible(
                child: Text(
                  hasValue ? widget.value : ref.t('locationDropdown.placeholder'),
                  style: hasValue
                      ? _valueStyle
                      : _valueStyle.copyWith(color: AppColors.charcoal2.withValues(alpha: 0.5)),
                ),
              ),
              const SizedBox(width: 8),
              Transform.rotate(
                angle: _isOpen ? math.pi : 0,
                child: SizedBox(
                  width: 6,
                  height: 6,
                  child: SvgPicture.asset('assets/icons/arrowDown.svg'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlacesPopup extends ConsumerStatefulWidget {
  const _PlacesPopup({required this.anchor});

  final Rect anchor;

  @override
  ConsumerState<_PlacesPopup> createState() => _PlacesPopupState();
}

class _PlacesPopupState extends ConsumerState<_PlacesPopup> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  List<Place> _places = const [];
  int _page = 1;
  bool _hasMorePages = true;
  bool _loadingPage = false;
  bool _searching = false;
  String _query = '';

  static const _text = TextStyle(fontFamily: AppFonts.ibmPlexSerifRegular, fontSize: 14, color: AppColors.lightGray3);

  @override
  void initState() {
    super.initState();
    _loadPage(1);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadPage(int page) async {
    setState(() => _loadingPage = true);
    try {
      final result = await ref.read(placesRepositoryProvider).getPlaces(page: page);
      if (!mounted || _query.trim().isNotEmpty) return;
      setState(() {
        if (page == 1) {
          _places = result.places;
          _hasMorePages = result.places.length < result.total;
        } else {
          final existing = _places.map((p) => p.id).toSet();
          _places = [..._places, ...result.places.where((p) => !existing.contains(p.id))];
          _hasMorePages = page * PlacesRepository.pageSize < result.total;
        }
        _page = page;
      });
    } catch (_) {
      // RN leaves the list as it was when a page fails.
    } finally {
      if (mounted) setState(() => _loadingPage = false);
    }
  }

  void _onQueryChanged(String text) {
    setState(() => _query = text);
    _debounce?.cancel();
    if (text.trim().isEmpty) {
      _loadPage(1);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 300), () => _search(text));
  }

  Future<void> _search(String query) async {
    setState(() => _searching = true);
    try {
      final results = await ref.read(placesRepositoryProvider).searchPlaces(query);
      if (mounted && _query == query) setState(() => _places = results);
    } catch (_) {
      if (mounted && _query == query) setState(() => _places = const []);
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  bool _onScroll(ScrollNotification notification) {
    final metrics = notification.metrics;
    if (metrics.pixels >= metrics.maxScrollExtent - 20 && _hasMorePages && !_loadingPage && _query.trim().isEmpty) {
      _loadPage(_page + 1);
    }
    return false;
  }

  Widget _message(String text) => Padding(
    padding: const EdgeInsets.all(20),
    child: Center(
      child: Text(text, style: _text, textAlign: TextAlign.center),
    ),
  );

  Widget _content() {
    final hasQuery = _query.isNotEmpty;
    if ((_searching || _loadingPage) && _places.isEmpty) {
      return _message(ref.t(hasQuery ? 'locationDropdown.searching' : 'locationDropdown.loadingPlaces'));
    }
    if (_places.isNotEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < _places.length; i++)
            InkWell(
              key: ValueKey('place-${_places[i].id}'),
              onTap: () => Navigator.of(context).pop(_places[i].displayName),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                decoration: i == _places.length - 1
                    ? null
                    : const BoxDecoration(
                        border: Border(bottom: BorderSide(color: AppColors.lightGray7)),
                      ),
                child: Text(_places[i].displayName, style: _text),
              ),
            ),
          if (_loadingPage && _page >= 1 && !hasQuery && _places.isNotEmpty && _hasMorePages)
            _message(ref.t('locationDropdown.loadingPlaces')),
        ],
      );
    }
    if (hasQuery) return _message(ref.t('locationDropdown.noLocationsFound'));
    return _message(ref.t('locationDropdown.startTypingToSearch'));
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final screenHeight = media.size.height;
    final keyboard = media.viewInsets.bottom;
    const maxModalHeight = 300.0;
    const minSpacing = 20.0;
    final anchor = widget.anchor;
    // RN `getModalPositioning`: under the header, or lifted above the
    // keyboard when it would cover the card.
    double top = anchor.bottom - 2;
    double maxHeight = math.min(maxModalHeight, math.max(150, screenHeight - anchor.bottom - minSpacing));
    if (keyboard > 0) {
      final available = screenHeight - keyboard;
      if (available - anchor.bottom < maxModalHeight + minSpacing) {
        top = math.max(minSpacing, available - maxModalHeight - minSpacing);
        maxHeight = math.min(maxModalHeight, available - top - minSpacing);
      }
    }
    return Stack(
      children: [
        Positioned(
          top: top,
          left: anchor.left,
          width: anchor.width,
          child: Material(
            color: Colors.transparent,
            child: Container(
              constraints: BoxConstraints(maxHeight: maxHeight),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.lightGray7),
                boxShadow: const [BoxShadow(color: Color(0x33000000), offset: Offset(0, 2), blurRadius: 4)],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    margin: const EdgeInsets.all(12),
                    padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
                    decoration: BoxDecoration(
                      color: AppColors.lightGray,
                      border: Border.all(color: AppColors.lightGray7),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Row(
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: SvgPicture.asset('assets/icons/search.svg', width: 16, height: 16),
                        ),
                        Expanded(
                          child: TextField(
                            key: const Key('location-search-input'),
                            controller: _searchController,
                            autofocus: true,
                            onChanged: _onQueryChanged,
                            style: const TextStyle(
                              fontFamily: AppFonts.ibmPlexSerifRegular,
                              fontSize: 14,
                              color: Colors.black,
                            ),
                            decoration: InputDecoration(
                              isCollapsed: true,
                              border: InputBorder.none,
                              hintText: ref.t('locationDropdown.searchPlaceholder'),
                              hintStyle: _text,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Flexible(
                    child: NotificationListener<ScrollNotification>(
                      onNotification: _onScroll,
                      child: SingleChildScrollView(child: _content()),
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
