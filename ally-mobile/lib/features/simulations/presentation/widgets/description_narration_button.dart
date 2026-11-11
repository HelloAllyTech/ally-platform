import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../reviews/presentation/simulation_audio_player_controller.dart';

enum NarrationStatus { idle, loading, playing, paused, error }

/// "Listen to description": streams the narration of a role-play description.
/// Renders nothing until [audioUrl] exists, so a scenario whose audio is still
/// being generated (or failed) simply shows no player. Audio is never the only
/// way to the content: an error leaves the description readable.
class DescriptionNarrationButton extends ConsumerStatefulWidget {
  const DescriptionNarrationButton({super.key, this.audioUrl, this.controller});

  final String? audioUrl;

  /// Overridable for tests; defaults to a real `audioplayers`-backed controller.
  final SimulationAudioPlaybackController? controller;

  @override
  ConsumerState<DescriptionNarrationButton> createState() =>
      _DescriptionNarrationButtonState();
}

class _DescriptionNarrationButtonState
    extends ConsumerState<DescriptionNarrationButton> {
  SimulationAudioPlaybackController? _controller;
  StreamSubscription<PlayerState>? _sub;
  NarrationStatus _status = NarrationStatus.idle;
  bool _sourceLoaded = false;

  SimulationAudioPlaybackController get _player {
    final existing = _controller;
    if (existing != null) return existing;
    final created = widget.controller ?? RealSimulationAudioPlaybackController();
    _sub = created.onPlayerStateChanged.listen((state) {
      if (!mounted) return;
      if (state == PlayerState.completed || state == PlayerState.stopped) {
        setState(() => _status = NarrationStatus.idle);
      }
    });
    return _controller = created;
  }

  @override
  void didUpdateWidget(DescriptionNarrationButton old) {
    super.didUpdateWidget(old);
    if (old.audioUrl != widget.audioUrl) {
      _sourceLoaded = false;
      _status = NarrationStatus.idle;
    }
  }

  Future<void> _toggle() async {
    final url = widget.audioUrl;
    if (url == null) return;
    if (_status == NarrationStatus.playing) {
      await _player.pause();
      if (mounted) setState(() => _status = NarrationStatus.paused);
      return;
    }
    setState(() => _status = NarrationStatus.loading);
    try {
      if (!_sourceLoaded) {
        await _player.setSourceUrl(url);
        _sourceLoaded = true;
      }
      await _player.resume();
      if (mounted) setState(() => _status = NarrationStatus.playing);
    } catch (_) {
      _sourceLoaded = false;
      if (mounted) setState(() => _status = NarrationStatus.error);
    }
  }

  @override
  void dispose() {
    unawaited(_sub?.cancel());
    unawaited(_controller?.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.audioUrl == null || widget.audioUrl!.isEmpty) {
      return const SizedBox.shrink();
    }
    final label = switch (_status) {
      NarrationStatus.playing => ref.t('learn.scenario.narration.pause'),
      NarrationStatus.paused => ref.t('learn.scenario.narration.resume'),
      _ => ref.t('learn.scenario.narration.listen'),
    };
    final icon = switch (_status) {
      NarrationStatus.playing => Icons.pause,
      _ => Icons.play_arrow,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          button: true,
          label: label,
          child: InkWell(
            key: const Key('description-narration-button'),
            borderRadius: BorderRadius.circular(8),
            onTap: _status == NarrationStatus.loading ? null : _toggle,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 44),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_status == NarrationStatus.loading)
                      const SizedBox(
                        key: Key('description-narration-loading'),
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    else
                      Icon(icon, size: 20, color: AppColors.primaryDefault),
                    const SizedBox(width: 8),
                    Text(
                      label,
                      style: const TextStyle(
                        fontFamily: AppFonts.robotoRegular,
                        fontSize: 14,
                        color: AppColors.primaryDefault,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (_status == NarrationStatus.error)
          Text(
            ref.t('learn.scenario.narration.error'),
            key: const Key('description-narration-error'),
            style: const TextStyle(fontSize: 12, color: Colors.red),
          ),
      ],
    );
  }
}
