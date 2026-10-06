import { RealtimeConnection } from './realtimeConnection.js';
import { RealtimeTurns } from './realtimeTurns.js';
import { RealtimeViewport } from './realtimeViewport.js';
import { RealtimeDiagnostics } from './realtimeDiagnostics.js';
import { RealtimeRadio } from './realtimeRadio.js';
import { RealtimeFacade } from './realtimeFacade.js';
import { RealtimeInput } from './realtimeInput.js';

import { shouldPauseRadioForVoice } from './realtimeProtocol.js';
import { postDebugLog } from './realtimeDiagnostics.js';

export {
  shouldPauseRadioForVoice,
  shouldStopVoiceAfterRadioTool,
  startPreparedRadioAfterPlaybackReady,
  silenceRadioForVoice,
} from './realtimeProtocol.js';
export {
  computeDownscale,
  estimateDataUrlBytes,
  renderFreshCesiumFrame,
  isBenignViewportDeleteError,
} from './realtimeViewport.js';
export {
  PUSH_TO_TALK_HOLD_DELAY_MS,
  isPushToTalkKey,
  isPushToTalkSurface,
  isInteractiveSpaceTarget,
  isEditingSpaceTarget,
  shouldHandlePushToTalkKeyDown,
  shouldIgnoreVoiceButtonClick,
  selectVoiceVisualizerSignal,
  resolveVoiceVisualizerSpeaker,
  resolveVoiceControlHint,
  gateVoiceVisualizerLevel,
} from './realtimeInputPolicy.js';

const STATUS = {
  idle: 'OFF',
  connecting: 'CONNECTING',
  listening: 'LISTENING',
  executing: 'EXECUTING',
  error: 'ERROR',
};

/** Compose voice state owners and coordinate ordered session startup/teardown. */
export class GevRealtimeController extends RealtimeFacade {
  constructor({
    runner,
    ui,
    radioLayer = null,
    dataManager = null,
    signal,
    debugSink = postDebugLog,
    actionExecutor,
    onSessionEvent,
    // Transport class. The voice session passes the Gemini Live transport; the
    // transport-neutral base is the default so the turn, tool and radio owners
    // can be driven directly in tests through a stand-in data channel.
    connectionClass = RealtimeConnection,
  }) {
    super();
    this.actionExecutor = actionExecutor;
    this.onSessionEvent = onSessionEvent;
    this.lifetimeSignal = signal;

    this.lifetimeAbort = () => this.stop({ removeUi: true });
    signal?.addEventListener('abort', this.lifetimeAbort, { once: true });
    this.runner = runner;
    this.ui = ui;
    this.radioLayer = radioLayer;
    this.dataManager = dataManager;
    this._viewport = new RealtimeViewport({
      readChannel: () => this.dc,

      operations: {
        sendRealtimeEvent: (...args) => this.sendRealtimeEvent(...args),
      },
    });
    this._diagnostics = new RealtimeDiagnostics({
      readStatus: () => this.status,
      readChannel: () => this.dc,
      debugSink,
      operations: {
        setStatus: (...args) => this.setStatus(...args),
      },
    });
    this._radio = new RealtimeRadio({
      readRadioLayer: () => this.radioLayer,
      readDataManager: () => this.dataManager,
      readChannel: () => this.dc,
      readUserTurnPending: () => this.userTurnPending,
      readSessionId: () => this.sessionId,

      operations: {
        abortTools: () => this._turns.abortTools(),
        isActive: (...args) => this.isActive(...args),
        stop: (...args) => this.stop(...args),
        setStatus: (...args) => this.setStatus(...args),
        queueResponseCreate: (...args) => this.queueResponseCreate(...args),
        debugLog: (...args) => this.debugLog(...args),
      },
    });
    this._input = new RealtimeInput({
      readUi: () => this.ui,
      readStream: () => this.stream,
      readStatus: () => this.status,
      operations: {
        isActive: (...args) => this.isActive(...args),
        setStatus: (...args) => this.setStatus(...args),
        start: (...args) => this.start(...args),
        pauseRadioForVoice: (...args) => this.pauseRadioForVoice(...args),
      },
    });

    this.buttonHandler = null;
    this.annotationEventUnsubscribe = null;

    this.status = 'idle';

    this._turns = new RealtimeTurns({
      readActionExecutor: () => this.actionExecutor,
      readRunner: () => this.runner,
      readChannel: () => this.dc,
      readDataManager: () => this.dataManager,
      readRadioLayer: () => this.radioLayer,
      radio: this._radio,
      viewport: this._viewport,
      operations: {
        cancelRadioHandoff: (...args) => this.cancelRadioHandoff(...args),
        connectionDiagnostics: (...args) => this.connectionDiagnostics(...args),
        debugLog: (...args) => this.debugLog(...args),
        emitSessionEvent: (...args) => this.emitSessionEvent(...args),
        isRadioHandoffReserved: (...args) =>
          this.isRadioHandoffReserved(...args),
        pauseRadioForVoice: (...args) => this.pauseRadioForVoice(...args),
        reportError: (...args) => this.reportError(...args),
        reserveRadioToolHandoff: (...args) =>
          this.reserveRadioToolHandoff(...args),
        sendRealtimeEvent: (...args) => this.sendRealtimeEvent(...args),
        sendVisualContextIfUseful: (...args) =>
          this.sendVisualContextIfUseful(...args),
        setStatus: (...args) => this.setStatus(...args),
        setVoiceSpeaker: (...args) => this.setVoiceSpeaker(...args),
        settleRadioToolHandoffReservation: (...args) =>
          this.settleRadioToolHandoffReservation(...args),
        startPendingRadioHandoff: (...args) =>
          this.startPendingRadioHandoff(...args),
        stop: (...args) => this.stop(...args),
      },
    });
    this._connection = this.buildConnection(connectionClass);
    this._radio.observe();
    this.debugLog('controller.created', { status: this.status });
  }

  /** Wire a transport instance to the state owners it reports to. */
  buildConnection(connectionClass) {
    return new connectionClass({
      readLifetimeSignal: () => this.lifetimeSignal,
      readStatus: () => this.status,
      input: this._input,
      operations: {
        isActive: (...args) => this.isActive(...args),
        pauseRadioForVoice: (...args) => this.pauseRadioForVoice(...args),
        stop: (...args) => this.stop(...args),
        setStatus: (...args) => this.setStatus(...args),
        debugLog: (...args) => this.debugLog(...args),
        connectionDiagnostics: (...args) => this.connectionDiagnostics(...args),
        setMicrophoneEnabled: (...args) => this.setMicrophoneEnabled(...args),
        startVoiceVisualizer: (...args) => this.startVoiceVisualizer(...args),
        startAssistantVoiceVisualizer: (...args) =>
          this.startAssistantVoiceVisualizer(...args),
        fatalError: (...args) => this.fatalError(...args),
        reportError: (...args) => this.reportError(...args),
        handleRealtimeEvent: (...args) => this.handleRealtimeEvent(...args),
      },
    });
  }

  isActive() {
    return this.status !== 'idle' && this.status !== 'error';
  }

  // Fatal error path: tear the session down (stop tracks, close the channel,
  // kill the mic) BEFORE flipping the UI to ERROR, so we never sit in an ERROR
  // state with a live hot mic behind it (H8). stop() itself bumps the epoch;
  // preserveStatus lets reportError own the final 'error' status.
  fatalError(source, error = null, extra = {}) {
    this.stop({ preserveStatus: true });
    return this.reportError(source, error, extra);
  }

  stop(options = {}) {
    const {
      removeUi = false,
      preserveStatus = false,
      preserveRadioPlayback = false,
    } = options;
    // Bump the epoch so any start() awaiting a session/getUserMedia bails and
    // releases its own resources instead of promoting them onto a stopped
    // controller (H7).
    this._connection.invalidate();
    if (removeUi)
      this.lifetimeSignal?.removeEventListener('abort', this.lifetimeAbort);
    this.cancelPushToTalkHold();
    this._radio.invalidateHandoff();
    this._turns.abortTools();
    this._radio.stopHandoff({ preserveRadioPlayback });
    // Guard against the dc.close() below re-entering our own error handlers while
    // we're intentionally tearing down (the close/error listeners bail on this
    // flag) — H8.
    this._connection.beginTeardown();
    this.debugLog('session.stop', {
      removeUi,
      preserveStatus,
      status: this.status,
      connection: this.connectionDiagnostics(),
    });
    this._connection.closeTransport();
    this.stopVoiceVisualizer();
    this._connection.releaseMedia();
    this._turns.reset();
    this._radio.clearPendingPlayback();
    this._viewport.reset();
    this._input.resetSession();
    if (removeUi && this.ui?.button && this.buttonHandler) {
      this.ui.button.removeEventListener('click', this.buttonHandler);
      this.buttonHandler = null;
    }
    if (removeUi) this._input.detachBindings();
    if (removeUi && this.annotationEventUnsubscribe) {
      // Full teardown (re-init path): stop listening to the long-lived annotation
      // engine so a replaced controller can't keep receiving outline events.
      this.annotationEventUnsubscribe();
      this.annotationEventUnsubscribe = null;
    }
    if (removeUi) this._radio.detachObservers();
    if (removeUi && this.ui?.root) {
      this.ui.root.remove();
    }
    if (!preserveStatus && !removeUi) {
      this.setStatus('idle', 'Voice off');
    }
    this.setRadioVoiceDucking(false);
    if (removeUi) this.emitSessionEvent({ type: 'disposed' });
  }

  emitSessionEvent(event) {
    try {
      this.onSessionEvent?.(event);
    } catch {
      /* Observers cannot interrupt voice. */
    }
  }

  setStatus(status, detail) {
    this.status = status;
    this.emitSessionEvent({ type: 'state', state: status, detail });
    this.ui.root.dataset.status = status;
    if (status === 'error') this.ui.root.classList.remove('error-dismissed');
    this.updateVoiceButtonLabel();
    this.ui.status.textContent = STATUS[status] || STATUS.idle;
    const resolvedDetail =
      status === 'listening' && this.pushToTalkMode
        ? this.pushToTalkKeyHeld
          ? 'Release Space to send'
          : 'Hold Space to talk'
        : detail;
    const primaryDetail =
      status === 'error'
        ? 'VOICE UNAVAILABLE'
        : resolvedDetail ||
          (status === 'idle' ? 'VOICE STANDBY' : 'VOICE ACTIVE');
    this.ui.detail.textContent = primaryDetail;
    this.ui.detail.title = primaryDetail;
    if (this.ui.errorDetail) {
      this.ui.errorDetail.textContent =
        status === 'error'
          ? resolvedDetail || 'Voice session could not be started.'
          : '';
    }
    if (status === 'idle' || status === 'connecting' || status === 'error') {
      this.setVoiceSpeaker('idle');
    }
    if (
      shouldPauseRadioForVoice({
        status,
        pushToTalkKeyHeld: this.pushToTalkKeyHeld,
      })
    ) {
      this.pauseRadioForVoice();
    }
  }
}
