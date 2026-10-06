import { RealtimeConnection } from './realtimeConnection.js';
import {
  createGeminiInboundTranslator,
  createGeminiOutbound,
} from './geminiProtocol.js';
import { createAudioPlayer, startAudioCapture } from './geminiAudio.js';

/**
 * Outbound events held back until Gemini reports `setupComplete`.
 *
 * Audio and the push-to-talk turn markers are produced the moment the
 * microphone opens, which is before the session behind the relay is ready. The
 * relay only queues a handful of frames while it dials upstream, so anything
 * past that was silently dropped — the start of the first utterance. They keep
 * their order relative to each other and flush together once the session is up.
 */
const HELD_UNTIL_READY = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_activity.start',
  'input_audio_activity.end',
]);

/** Upper bound on held events (~16 s of microphone), so a stalled setup cannot grow without limit. */
const HELD_EVENT_LIMIT = 6000;

/**
 * Gemini Live transport.
 *
 * GEV's turn, tool, radio and viewport owners all read `this.dc` and speak a
 * Realtime-style event vocabulary (conversation items, responses, function
 * calls). This transport presents a data-channel-shaped facade over a
 * same-origin WebSocket and translates to and from Gemini Live, so everything
 * above it — including all 28 actions — is transport-neutral.
 *
 * Only `start`, `sendRealtimeEvent` and media release are overridden; the
 * epoch, teardown and abandon logic is inherited from the base class.
 */
export class GeminiRealtimeConnection extends RealtimeConnection {
  constructor(options) {
    super(options);
    this.ws = null;
    this.capture = null;
    this.player = null;
    this.audioContext = null;
    this.translator = createGeminiInboundTranslator();
    this.outbound = createGeminiOutbound({
      send: (message) => this.sendFrame(message),
    });
    this.sessionEndpoint =
      options?.sessionEndpoint || '/api/realtime/gemini-session';
    this.manualActivity = false;
    this.activityOpen = false;
    this.micLive = false;
    this.ready = false;
    this.held = [];

    // The controller supplies setMicrophoneEnabled as an own property, which
    // would shadow a subclass method. Wrap it instead: muting the track is not
    // enough here, because a disabled track still yields silent frames the
    // worklet would keep streaming, and push-to-talk needs the turn marked.
    const baseSetMicrophoneEnabled = this.setMicrophoneEnabled;
    this.setMicrophoneEnabled = (enabled) => {
      baseSetMicrophoneEnabled?.call(this, enabled);
      this.gateCapture(Boolean(enabled));
    };
  }

  /**
   * Stop sending audio when muted, and mark the turn in push-to-talk.
   *
   * Called before the socket exists too (the first mic state is set while the
   * session is still connecting), so the desired state is recorded and the
   * marker is flushed once the socket opens.
   */
  gateCapture(enabled) {
    this.micLive = Boolean(enabled);
    this.capture?.setEnabled(this.micLive);
    this.syncActivityMarker();
  }

  /** Emit the activity marker when it can actually reach Gemini. */
  syncActivityMarker() {
    if (!this.manualActivity) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.micLive === this.activityOpen) return;
    this.activityOpen = this.micLive;
    this.forwardToGemini({
      type: this.micLive
        ? 'input_audio_activity.start'
        : 'input_audio_activity.end',
    });
  }

  /** Data-channel facade so `readChannel()` consumers need no changes. */
  createChannelFacade(socket) {
    const connection = this;
    return {
      label: 'gemini-live',
      get readyState() {
        return socket.readyState === WebSocket.OPEN ? 'open' : 'closed';
      },
      send(payload) {
        connection.forwardToGemini(payload);
      },
      close() {
        try {
          socket.close();
        } catch {
          /* already closing */
        }
      },
    };
  }

  /**
   * Translate one outbound GEV event and write it to the socket.
   *
   * @returns {boolean} False only for a `response.create` Gemini was not asked
   *   to act on (see `createGeminiOutbound`).
   */
  forwardToGemini(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return true;
    let event;
    try {
      event = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch {
      return true;
    }
    if (!this.ready && HELD_UNTIL_READY.has(event?.type)) {
      if (this.held.length < HELD_EVENT_LIMIT) this.held.push(event);
      return true;
    }
    return this.writeToGemini(event);
  }

  /** Hand one GEV event to the outbound bridge, which writes zero or more frames. */
  writeToGemini(event) {
    return this.outbound.forward(event);
  }

  /** Write one finished Gemini message to the socket. */
  sendFrame(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      this.debugLog('gemini.send.failed', {
        error: error?.message || String(error),
      });
    }
  }

  /** Gemini accepted the setup frame: release everything captured meanwhile, in order. */
  markReady() {
    if (this.ready) return;
    this.ready = true;
    const held = this.held;
    this.held = [];
    for (const event of held) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.writeToGemini(event);
    }
  }

  async start({ pushToTalk = false } = {}) {
    if (this.isActive() || this.lifetimeSignal?.aborted) return;
    this.pauseRadioForVoice();
    const pushToTalkKeyHeld = pushToTalk && this.input.pushToTalkKeyHeld;
    const spaceKeyHeld = this.input.spaceKeyHeld;
    this.stop({ preserveStatus: true });
    this.input.pushToTalkMode = pushToTalk;
    this.input.pushToTalkKeyHeld = pushToTalkKeyHeld;
    this.input.spaceKeyHeld = spaceKeyHeld;

    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      this.setStatus('error', 'Microphone or Web Audio support unavailable');
      return;
    }

    if (this.lifetimeSignal?.aborted) return;
    const epoch = ++this.startEpoch;
    this.connectionAbort?.abort();
    this.connectionAbort = new AbortController();
    const signal = AbortSignal.any(
      [this.connectionAbort.signal, this.lifetimeSignal].filter(Boolean),
    );

    this.setStatus('connecting', 'Requesting microphone');
    this.translator.reset();
    this.outbound.reset();
    this.ready = false;
    this.held = [];

    let localStream = null;
    let socket = null;
    try {
      const minted = await this.requestGeminiSession(signal, { pushToTalk });
      if (this.abandonStart(epoch, { localStream })) return;

      // With automatic detection disabled server-side, the client owns the
      // turn boundaries from here on.
      this.manualActivity = Boolean(minted.pushToTalk);
      this.activityOpen = false;

      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (this.abandonStart(epoch, { localStream })) return;
      this.stream = localStream;
      this.setMicrophoneEnabled(
        !this.input.pushToTalkMode || this.input.pushToTalkKeyHeld,
      );
      this.startVoiceVisualizer(localStream);

      this.audioContext = new AudioContext();
      this.player = createAudioPlayer({ audioContext: this.audioContext });

      socket = new WebSocket(minted.socketUrl);
      this.ws = socket;
      const owns = () =>
        epoch === this.startEpoch && this.ws === socket && !signal.aborted;

      socket.addEventListener('open', () => {
        if (!owns()) return;
        // The setup frame is composed server-side; forwarding it verbatim
        // keeps instructions and tool declarations in one place.
        socket.send(JSON.stringify({ setup: minted.setup }));
        // The first mic state was decided while this socket was still
        // connecting, so its turn marker is flushed here.
        this.syncActivityMarker();
      });

      socket.addEventListener('message', (event) => {
        if (!owns()) return;
        this.handleGeminiMessage(event.data);
      });

      socket.addEventListener('error', () => {
        if (this._tearingDown || !owns()) return;
        this.fatalError(
          'Gemini Live socket',
          null,
          this.connectionDiagnostics(),
        );
      });

      socket.addEventListener('close', (event) => {
        if (this._tearingDown || !owns()) return;
        if (this.status !== 'idle' && this.status !== 'error') {
          this.fatalError('Gemini Live socket closed', null, {
            code: event?.code ?? null,
            reason: event?.reason || null,
            ...this.connectionDiagnostics(),
          });
        }
      });

      this.dc = this.createChannelFacade(socket);
      this.capture = await startAudioCapture({
        stream: localStream,
        audioContext: this.audioContext,
        onChunk: (audio) => {
          if (!owns()) return;
          this.forwardToGemini({ type: 'input_audio_buffer.append', audio });
        },
      });
      if (this.abandonStart(epoch, { localStream })) return;
      // From here a mute or unmute from the input owner (the Space key) also
      // gates this capture and marks the turn boundary. Without it, releasing
      // Space only disabled the track: silent frames kept streaming and Gemini
      // never saw the turn end.
      this.input.microphoneGate = (enabled) => this.gateCapture(enabled);
      this.gateCapture(
        !this.input.pushToTalkMode || this.input.pushToTalkKeyHeld,
      );

      this.setStatus(
        'listening',
        this.input.pushToTalkMode
          ? this.input.pushToTalkKeyHeld
            ? 'Release Space to send'
            : 'Hold Space to talk'
          : 'Ask or command',
      );
      this.debugLog('gemini.session.open', { model: minted.model });
    } catch (error) {
      if (epoch !== this.startEpoch) {
        localStream?.getTracks?.().forEach((track) => track.stop());
        try {
          socket?.close();
        } catch {
          /* already closing */
        }
        return;
      }
      const diagnostics = this.connectionDiagnostics();
      this.stop({ preserveStatus: true });
      this.reportError('Gemini Live connection', error, diagnostics);
    }
  }

  async requestGeminiSession(signal, { pushToTalk = false } = {}) {
    // The turn-detection mode is fixed in the setup frame, so it has to be
    // known before the socket opens.
    const separator = this.sessionEndpoint.includes('?') ? '&' : '?';
    const endpoint = pushToTalk
      ? `${this.sessionEndpoint}${separator}mode=push-to-talk`
      : this.sessionEndpoint;
    const response = await fetch(endpoint, {
      signal,
      cache: 'no-store',
      redirect: 'error',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        data?.error || `Gemini session failed: HTTP ${response.status}`,
      );
    }
    if (!data?.socketPath || !data?.setup) {
      throw new Error('Gemini session response was incomplete');
    }
    // Same-origin relay: the server attaches the API key upstream, so no
    // credential is carried here and the scheme follows the page's own.
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return {
      ...data,
      socketUrl: `${scheme}//${window.location.host}${data.socketPath}`,
    };
  }

  /** Translate an inbound frame into GEV events and queued audio. */
  handleGeminiMessage(raw) {
    const deliver = (text) => {
      const { events, audio, toolCalls, cancelledCalls } =
        this.translator.translate(text);
      if (events.some((event) => event.type === 'session.created'))
        this.markReady();
      // Open the batch before the calls are dispatched, so a fast tool's
      // result always finds it.
      if (toolCalls) this.outbound.openToolBatch(toolCalls);
      if (cancelledCalls) this.outbound.cancelToolCalls(cancelledCalls);
      for (const chunk of audio) this.player?.enqueue(chunk);
      for (const event of events) {
        // Barge-in must drop already-scheduled audio, not just stop new audio.
        if (event.type === 'output_audio_buffer.cleared') this.player?.clear();
        this.handleRealtimeEvent({ data: JSON.stringify(event) });
      }
    };

    // Gemini may deliver frames as Blob depending on the browser.
    if (typeof raw === 'string') {
      deliver(raw);
      return;
    }
    if (raw instanceof Blob) {
      raw
        .text()
        .then(deliver)
        .catch(() => {});
      return;
    }
    if (raw instanceof ArrayBuffer) {
      deliver(new TextDecoder().decode(raw));
    }
  }

  /**
   * Send one GEV event. Answers whether the event went out, with one addition:
   * a `response.create` that asked Gemini for nothing answers false, so the turn
   * owner does not wait for a response that will never be generated for it
   * (Gemini already replies to a toolResponse).
   */
  sendRealtimeEvent(message, logEventName = 'client.event') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.debugLog(logEventName, { type: message?.type || null, message });
    return this.forwardToGemini(message) !== false;
  }

  setCaptureEnabled(enabled) {
    this.capture?.setEnabled(enabled);
  }

  closeTransport() {
    this.activityOpen = false;
    this.micLive = false;
    this.ready = false;
    this.held = [];
    this.outbound.reset();
    if (this.input?.microphoneGate) this.input.microphoneGate = null;
    if (this.capture) {
      this.capture.stop();
      this.capture = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closing */
      }
      this.ws = null;
    }
    this.dc = null;
    this._tearingDown = false;
  }

  releaseMedia() {
    if (this.player) {
      this.player.stop();
      this.player = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.translator.reset();
    this.outbound.reset();
    super.releaseMedia();
  }
}
