/**
 * Audio plumbing for the Gemini Live transport.
 *
 * A media-track transport would do all of this implicitly: the browser captures,
 * encodes and plays audio itself. Gemini Live is a JSON WebSocket, so raw PCM has
 * to be produced and consumed by hand — 16 kHz mono PCM16 up, 24 kHz mono
 * PCM16 down.
 *
 * The sample math is kept pure and separate from the Web Audio wiring so the
 * easy-to-get-wrong half is unit-testable.
 */

import {
  GEMINI_INPUT_SAMPLE_RATE,
  GEMINI_OUTPUT_SAMPLE_RATE,
} from './geminiProtocol.js';

/**
 * Resample mono float samples with linear interpolation.
 *
 * Voice at these rates does not justify a windowed-sinc filter; linear
 * interpolation is what the Live API cookbooks use and is inaudible here.
 *
 * @param {Float32Array} input - Mono samples.
 * @param {number} inputRate - Source sample rate in Hz.
 * @param {number} outputRate - Target sample rate in Hz.
 * @returns {Float32Array} Resampled mono samples.
 */
export function resampleMono(input, inputRate, outputRate) {
  if (!(input instanceof Float32Array)) return new Float32Array(0);
  if (!input.length || !inputRate || !outputRate) return new Float32Array(0);
  if (inputRate === outputRate) return input.slice();

  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, input.length - 1);
    const weight = position - index;
    output[i] = input[index] * (1 - weight) + input[next] * weight;
  }
  return output;
}

/**
 * Convert float samples in [-1, 1] to little-endian PCM16 bytes.
 *
 * @param {Float32Array} input - Mono samples.
 * @returns {Uint8Array} Interleaved little-endian 16-bit samples.
 */
export function floatToPcm16(input) {
  if (!(input instanceof Float32Array) || !input.length)
    return new Uint8Array(0);
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < input.length; i += 1) {
    // Clamp before scaling: an over-unity sample would wrap and click.
    const clamped = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, Math.round(clamped * 32767), true);
  }
  return bytes;
}

/**
 * Convert little-endian PCM16 bytes back to float samples in [-1, 1].
 *
 * @param {Uint8Array} bytes - Little-endian 16-bit mono samples.
 * @returns {Float32Array} Mono samples.
 */
export function pcm16ToFloat(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2)
    return new Float32Array(0);
  const count = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  const output = new Float32Array(count);
  for (let i = 0; i < count; i += 1)
    output[i] = view.getInt16(i * 2, true) / 32768;
  return output;
}

/** Encode bytes as base64 without blowing the call stack on long buffers. */
export function bytesToBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return '';
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decode base64 to bytes, returning empty on malformed input. */
export function base64ToBytes(value) {
  if (typeof value !== 'string' || !value) return new Uint8Array(0);
  let binary;
  try {
    binary = atob(value);
  } catch {
    return new Uint8Array(0);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Worklet source. Inlined as a Blob so no extra build entry is needed. */
const CAPTURE_WORKLET = `
class GevCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice());
    return true;
  }
}
registerProcessor('gev-capture', GevCaptureProcessor);
`;

/**
 * Stream microphone audio as base64 PCM16 chunks at Gemini's input rate.
 *
 * @param {object} options
 * @param {MediaStream} options.stream - Live microphone stream.
 * @param {AudioContext} options.audioContext - Context owning the graph.
 * @param {(chunk: string) => void} options.onChunk - Receives base64 PCM16.
 * @returns {Promise<{stop: () => void, setEnabled: (on: boolean) => void}>}
 */
export async function startAudioCapture({ stream, audioContext, onChunk }) {
  const blob = new Blob([CAPTURE_WORKLET], { type: 'application/javascript' });
  const moduleUrl = URL.createObjectURL(blob);
  try {
    await audioContext.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }

  const source = audioContext.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioContext, 'gev-capture');
  let enabled = true;

  worklet.port.onmessage = (event) => {
    if (!enabled) return;
    const samples = event.data;
    if (!samples?.length) return;
    const resampled = resampleMono(
      samples,
      audioContext.sampleRate,
      GEMINI_INPUT_SAMPLE_RATE,
    );
    const encoded = bytesToBase64(floatToPcm16(resampled));
    if (encoded) onChunk(encoded);
  };

  source.connect(worklet);
  // A worklet with no destination is not pulled in every browser; a silent
  // gain sink keeps it running without making the mic audible.
  const sink = audioContext.createGain();
  sink.gain.value = 0;
  worklet.connect(sink);
  sink.connect(audioContext.destination);

  return {
    setEnabled(on) {
      enabled = Boolean(on);
    },
    stop() {
      enabled = false;
      worklet.port.onmessage = null;
      try {
        source.disconnect();
        worklet.disconnect();
        sink.disconnect();
      } catch {
        /* already torn down */
      }
    },
  };
}

/**
 * Gapless scheduler for model audio.
 *
 * Chunks arrive faster than realtime, so each is scheduled against a running
 * cursor rather than played on arrival — otherwise they overlap into noise.
 *
 * @param {object} options
 * @param {AudioContext} options.audioContext - Context owning playback.
 * @returns {{enqueue: (b64: string) => void, clear: () => void, stop: () => void, node: GainNode}}
 */
export function createAudioPlayer({ audioContext }) {
  const output = audioContext.createGain();
  output.connect(audioContext.destination);

  let cursor = 0;
  let sources = [];

  return {
    node: output,

    enqueue(base64) {
      const samples = pcm16ToFloat(base64ToBytes(base64));
      if (!samples.length) return;

      const buffer = audioContext.createBuffer(
        1,
        samples.length,
        GEMINI_OUTPUT_SAMPLE_RATE,
      );
      buffer.copyToChannel(samples, 0);

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(output);

      // A cursor behind the clock means playback drained; restart from now
      // plus a small cushion so the next chunk does not land in the past.
      const now = audioContext.currentTime;
      if (cursor < now) cursor = now + 0.02;
      source.start(cursor);
      cursor += buffer.duration;

      sources.push(source);
      source.onended = () => {
        sources = sources.filter((entry) => entry !== source);
      };
    },

    /** Barge-in: drop everything queued so the model stops mid-sentence. */
    clear() {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          /* already ended */
        }
      }
      sources = [];
      cursor = 0;
    },

    stop() {
      this.clear();
      try {
        output.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}
