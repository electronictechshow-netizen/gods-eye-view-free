function releaseStartResources({ localStream = null } = {}) {
  if (localStream) {
    try {
      localStream.getTracks().forEach((track) => track.stop());
    } catch {
      /* no-op */
    }
  }
}

/**
 * Own connection generations, the live channel and acquired media resources.
 *
 * This is the transport-neutral base: it knows nothing about how a session is
 * established. A concrete transport (see `geminiConnection.js`) supplies
 * `start()`, presents a data-channel-shaped `dc`, and overrides `closeTransport`
 * and `releaseMedia` for what it owns.
 */
export class RealtimeConnection {
  constructor({ readLifetimeSignal, readStatus, input, operations }) {
    Object.assign(this, { readLifetimeSignal, readStatus, input }, operations);
    this.connectionAbort = null;
    this.dc = null;
    this.stream = null;
    this.startEpoch = 0;
    this._tearingDown = false;
  }
  get lifetimeSignal() {
    return this.readLifetimeSignal();
  }
  get status() {
    return this.readStatus();
  }

  /** A transport must provide its own start(). */
  async start() {
    this.setStatus('error', 'No voice transport is configured');
  }

  // Returns true (and tears down the just-acquired resources) when this start()
  // attempt has been superseded by a newer start()/stop() — the caller must
  // then `return` immediately without touching shared session state (H7).
  abandonStart(epoch, resources) {
    if (epoch === this.startEpoch) return false;
    // These resources may or may not have been promoted onto `this` yet. If a
    // stop() bumped the epoch it already tore down whatever was promoted; if a
    // *second* start() bumped it, that start owns `this.stream` now, so only
    // null the ref when it still points at OUR abandoned local — never the
    // successor's. Then release the local unconditionally (idempotent).
    if (resources.localStream && this.stream === resources.localStream)
      this.stream = null;
    releaseStartResources(resources);
    this.debugLog('session.start.abandoned', {
      epoch,
      currentEpoch: this.startEpoch,
    });
    return true;
  }

  sendRealtimeEvent(message, logEventName = 'client.event') {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.debugLog(logEventName, {
      type: message?.type || null,
      message,
    });
    // A dc.send() that exceeds the channel's max message size throws. If that
    // throw escaped it would abort handleRealtimeEvent BEFORE
    // queueResponseCreate + setStatus('listening'), stranding the turn at
    // EXECUTING. Swallow it and signal failure so callers can fall through
    // without the offending payload (M13).
    try {
      this.dc.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.debugLog('client.send.failed', {
        logEventName,
        type: message?.type || null,
        error: error?.message || String(error),
      });
      return false;
    }
  }

  invalidate() {
    this.startEpoch++;
    this.connectionAbort?.abort();
    this.connectionAbort = null;
  }

  closeTransport() {
    if (this.dc) {
      try {
        this.dc.close();
      } catch {
        /* no-op */
      }
      this.dc = null;
    }
    this._tearingDown = false;
  }

  releaseMedia() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  beginTeardown() {
    this._tearingDown = true;
  }
}
