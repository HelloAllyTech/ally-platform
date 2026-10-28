import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/localization/translate_ref.dart';
import '../../../../core/realtime/microphone_permission.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/root_scaffold_messenger.dart';
import '../../data/simulation_models.dart';
import '../../data/simulations_repository.dart';
import 'start_simulation_modals.dart';

/// What to start — RN's `StartSimulationParams` (`useStartSimulation.ts`).
class StartSimulationParams {
  const StartSimulationParams({
    required this.scenarioId,
    this.scenarioPathSessionItemId,
    this.caseSessionItemId,
    this.trackItemProgressId,
    this.languageId,
    this.scenario,
    this.pathId,
    this.caseId,
  });

  final int scenarioId;
  final String? scenarioPathSessionItemId;
  final String? caseSessionItemId;

  /// Links the session to a Track 2.0 roleplay item's progress row.
  final String? trackItemProgressId;
  final int? languageId;

  /// The caller's own copy of the scenario, used for the live screen when
  /// the start response's `scenario` can't be read.
  final Scenario? scenario;

  /// RN `useStartSimulation` `pathId`/`caseId`: carried to the live screen
  /// and on to Feedback, whose back then returns to that path/case.
  final String? pathId;
  final String? caseId;
}

enum StartSimulationErrorKind { rateLimited, activeSimulation, other }

/// A failed start call, classified the way `useStartSimulation` branches:
/// HTTP 429 → retry modal; a body carrying `entityId` (ally-be's
/// `EntityOperationException`, the already-running session) → active-
/// simulation modal; anything else → error toast.
class StartSimulationError {
  const StartSimulationError._(this.kind, {this.entityId, this.message});

  factory StartSimulationError.from(Object error) {
    if (error is DioException) {
      final response = error.response;
      if (response?.statusCode == 429) {
        return const StartSimulationError._(StartSimulationErrorKind.rateLimited);
      }
      final data = response?.data;
      if (data is Map) {
        final entityId = data['entityId'];
        if (entityId is String && entityId.isNotEmpty) {
          return StartSimulationError._(
            StartSimulationErrorKind.activeSimulation,
            entityId: entityId,
          );
        }
        final message = data['message'] ?? data['error'];
        if (message is String && message.trim().isNotEmpty) {
          return StartSimulationError._(StartSimulationErrorKind.other, message: message);
        }
      }
    }
    return const StartSimulationError._(StartSimulationErrorKind.other);
  }

  final StartSimulationErrorKind kind;
  final String? entityId;

  /// The backend's own `message`/`error`, when it sent one.
  final String? message;
}

/// Opens the live session — RN's `navigation.navigate(SIMULATION_ASSISTANT)`.
typedef StartSimulationLauncher =
    void Function(BuildContext context, SessionData session, StartSimulationParams params);

void _pushRoleplay(BuildContext context, SessionData session, StartSimulationParams params) {
  GoRouter.maybeOf(context)?.push(
    '/roleplay',
    extra: {
      'liveKitServerUrl': session.liveKitServerUrl,
      'accessToken': session.accessToken,
      'scenarioSessionId': session.id,
      'scenario': session.scenario ?? params.scenario,
      'pathId': ?params.pathId,
      'caseId': ?params.caseId,
      'languageId': ?params.languageId,
    },
  );
}

/// Port of ally-mobile (React Native)'s `hooks/useStartSimulation.ts` plus
/// the modal set and low-credit check every start surface wires around it
/// (SimulationDetailsScreen, SimulationPathDetailsScreen, CaseDetailsScreen,
/// the course RoleplayCasePlayer). One per screen state; listen to it for
/// [isCreatingRoom].
///
/// The microphone is checked BEFORE the session is created, as RN does, so
/// a denied mic never spends a simulation credit: blocked → "Allow
/// microphone" settings alert, denied → error toast.
class StartSimulationController extends ChangeNotifier {
  StartSimulationController(this._ref, {StartSimulationLauncher? launch})
    : _launch = launch ?? _pushRoleplay;

  final WidgetRef _ref;
  final StartSimulationLauncher _launch;

  bool _isCreatingRoom = false;
  bool get isCreatingRoom => _isCreatingRoom;

  bool _disposed = false;
  bool? _wasLow;
  Route<void>? _lowCreditsRoute;
  Timer? _lowCreditsTimer;

  /// RN's `LOW_CREDITS_MODAL_DISPLAY_MS`.
  static const lowCreditsDisplay = Duration(seconds: 5);

  SimulationsRepository get _repository => _ref.read(simulationsRepositoryProvider);

  void _setCreatingRoom(bool value) {
    if (_disposed || _isCreatingRoom == value) return;
    _isCreatingRoom = value;
    notifyListeners();
  }

  Future<SessionData> _callSessionStart(StartSimulationParams params) {
    return _repository.startScenarioSession(
      scenarioId: params.scenarioId,
      scenarioPathSessionItemId: params.scenarioPathSessionItemId,
      caseSessionItemId: params.caseSessionItemId,
      trackItemProgressId: params.trackItemProgressId,
      languageId: params.languageId,
    );
  }

  /// RN's `NotificationModal` step: "Before you get started", then
  /// [start] on confirm. Resolves `false` when the learner closed it.
  /// [barrierColor] lets a caller that is itself a dialog (the path/case
  /// details modal, which RN hides while this shows) avoid double-dimming.
  Future<bool> confirmAndStart(
    BuildContext context,
    StartSimulationParams params, {
    VoidCallback? onSettled,
    Color barrierColor = AppColors.blackTransparent50,
  }) async {
    final confirmed = await PreStartNotificationModal.show(context, barrierColor: barrierColor);
    if (!confirmed || !context.mounted) return false;
    return start(context, params, onSettled: onSettled);
  }

  /// RN's `startSimulation`: start the session and open the live screen;
  /// on failure show the retry modal (429), the active-simulation modal
  /// (`entityId`), or an error toast. [onSettled] runs as soon as the start
  /// call returns, before any of that — RN closes the path/case details
  /// modal at that point (`.finally(handleCloseModal)`). Resolves `true`
  /// once the live screen was opened.
  Future<bool> start(
    BuildContext context,
    StartSimulationParams params, {
    VoidCallback? onSettled,
  }) async {
    if (_isCreatingRoom) return false;
    if (!await _ensureMicrophone(context)) return false;
    if (!context.mounted) return false;
    _setCreatingRoom(true);
    SessionData session;
    try {
      session = await _callSessionStart(params);
    } catch (error) {
      _setCreatingRoom(false);
      onSettled?.call();
      if (!context.mounted) return false;
      return _handleStartError(context, StartSimulationError.from(error), params);
    }
    _setCreatingRoom(false);
    onSettled?.call();
    if (!context.mounted) return false;
    _launch(context, session, params);
    return true;
  }

  /// RN `startSimulation`'s permission block (`request(MICROPHONE)`).
  Future<bool> _ensureMicrophone(BuildContext context) async {
    final result = await requestMicrophonePermission();
    if (result == MicrophonePermissionResult.granted) return true;
    if (!context.mounted) return false;
    if (result == MicrophonePermissionResult.blocked) {
      await showPermissionSettingsAlert(
        context,
        title: _ref.tr('simulationPage.allowMicrophone'),
        message: _ref.tr('simulationPage.microphonePrompt'),
        cancelLabel: _ref.tr('common.cancel'),
        settingsLabel: _ref.tr('common.ok'),
      );
    } else {
      // RN: showErrorToast(new Error(microphonePrompt), 'errors.permission').
      _toast(context, '${_ref.tr('errors.permission')}: ${_ref.tr('simulationPage.microphonePrompt')}');
    }
    return false;
  }

  Future<bool> _handleStartError(
    BuildContext context,
    StartSimulationError error,
    StartSimulationParams params,
  ) async {
    switch (error.kind) {
      case StartSimulationErrorKind.rateLimited:
        return _showRetry(context, params);
      case StartSimulationErrorKind.activeSimulation:
        await _showActiveSimulation(context, error.entityId!);
        return false;
      case StartSimulationErrorKind.other:
        _toast(context, _errorMessage('errors.startSimulation', error));
        return false;
    }
  }

  /// RN's `retryStartSimulation` + `RetrySessionModal`. The retried session
  /// (or the active-simulation follow-up) is acted on only after the modal
  /// has closed, so a pushed screen never lands under a dialog.
  Future<bool> _showRetry(
    BuildContext context,
    StartSimulationParams params,
  ) async {
    SessionData? started;
    StartSimulationError? followUp;
    await RetrySessionModal.show(
      context,
      onRetry: () async {
        try {
          started = await _callSessionStart(params);
          return true;
        } catch (e) {
          final error = StartSimulationError.from(e);
          if (error.kind == StartSimulationErrorKind.rateLimited) return false;
          followUp = error;
          return true;
        }
      },
    );
    if (!context.mounted) return false;
    final session = started;
    if (session != null) {
      _launch(context, session, params);
      return true;
    }
    final error = followUp;
    if (error == null) return false;
    if (error.kind == StartSimulationErrorKind.activeSimulation) {
      await _showActiveSimulation(context, error.entityId!);
    } else {
      _toast(context, _errorMessage('errors.startSimulation', error));
    }
    return false;
  }

  Future<void> _showActiveSimulation(BuildContext context, String scenarioSessionId) {
    return ActiveSimulationModal.show(
      context,
      onEndSession: () async {
        try {
          await _repository.endScenarioSession(scenarioSessionId);
          if (context.mounted) _toast(context, _ref.tr('common.simulationEndedSuccess'));
        } catch (e) {
          if (context.mounted) {
            _toast(context, _errorMessage('errors.endSimulation', StartSimulationError.from(e)));
          }
        }
      },
    );
  }

  /// RN's `useEffect` on `getCreditsInfo?.isLow`: each time credits turn
  /// low (including credits that are already low when the screen opens),
  /// show the low-credits modal and hide it again after 5 s. Call from
  /// `build` with the current credits.
  void onCredits(
    BuildContext context,
    SimulationCredits? credits, {
    bool largeDescription = false,
  }) {
    final isLow = credits?.isLow;
    final turnedLow = isLow == true && _wasLow != true;
    _wasLow = isLow;
    if (!turnedLow) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_disposed || !context.mounted) return;
      _showLowCredits(context, largeDescription);
    });
  }

  void _showLowCredits(BuildContext context, bool largeDescription) {
    final navigator = Navigator.of(context, rootNavigator: true);
    final route = DialogRoute<void>(
      context: context,
      barrierDismissible: false,
      barrierColor: AppColors.blackTransparent50,
      builder: (_) => LowCreditsModal(largeDescription: largeDescription),
    );
    _lowCreditsRoute = route;
    navigator.push(route);
    _lowCreditsTimer?.cancel();
    _lowCreditsTimer = Timer(lowCreditsDisplay, _hideLowCredits);
  }

  void _hideLowCredits() {
    final route = _lowCreditsRoute;
    _lowCreditsRoute = null;
    if (route != null && route.isActive) {
      route.navigator?.removeRoute(route);
    }
  }

  String _errorMessage(String fallbackKey, StartSimulationError error) {
    final fallback = _ref.tr(fallbackKey);
    final message = error.message;
    // RN's showErrorToast: "Failed to start simulation: {reason}".
    return message == null ? fallback : '$fallback: $message';
  }

  void _toast(BuildContext context, String message) {
    final messenger = ScaffoldMessenger.maybeOf(context) ?? rootScaffoldMessengerKey.currentState;
    messenger?.showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  void dispose() {
    _disposed = true;
    _lowCreditsTimer?.cancel();
    // Not synchronously: the navigator can't change while the tree that's
    // disposing this is locked.
    scheduleMicrotask(_hideLowCredits);
    super.dispose();
  }
}
