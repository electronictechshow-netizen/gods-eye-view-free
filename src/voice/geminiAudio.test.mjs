import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToBytes,
  bytesToBase64,
  floatToPcm16,
  pcm16ToFloat,
  resampleMono,
} from './geminiAudio.js';

function sine(length, rate, hz) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1)
    out[i] = Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

test('48 kHz capture downsamples to a third of the samples', () => {
  const input = sine(4800, 48000, 440);
  const output = resampleMono(input, 48000, 16000);
  assert.equal(output.length, 1600, '100ms at 16 kHz is 1600 samples');
});

test('resampling preserves the waveform rather than garbling it', () => {
  // A 100 Hz tone resampled to 16 kHz should still be a 100 Hz tone: compare
  // against a directly generated reference instead of trusting the length.
  const output = resampleMono(sine(4800, 48000, 100), 48000, 16000);
  const reference = sine(1600, 16000, 100);
  let worst = 0;
  for (let i = 0; i < reference.length; i += 1)
    worst = Math.max(worst, Math.abs(output[i] - reference[i]));
  assert.ok(
    worst < 0.02,
    `resampled tone tracks the reference (worst ${worst})`,
  );
});

test('an unchanged rate copies rather than resamples', () => {
  const input = sine(128, 16000, 440);
  const output = resampleMono(input, 16000, 16000);
  assert.deepEqual([...output], [...input]);
  assert.notEqual(output, input, 'returns a copy, not the caller’s buffer');
});

test('PCM16 round-trips within two quantisation steps', () => {
  // Encoding scales by 32767 and decoding by 32768 — the standard asymmetric
  // convention — so a full-scale sample loses ~1 LSB to the scale difference
  // on top of ~0.5 LSB of rounding. Two LSB is the honest bound; anything
  // larger would mean a real conversion bug.
  const input = sine(512, 16000, 440);
  const restored = pcm16ToFloat(floatToPcm16(input));
  assert.equal(restored.length, input.length);
  let worst = 0;
  for (let i = 0; i < input.length; i += 1)
    worst = Math.max(worst, Math.abs(restored[i] - input[i]));
  assert.ok(worst < 2 / 32768, `round-trip error ${worst}`);
});

test('out-of-range samples clamp instead of wrapping', () => {
  // Without clamping, +1.5 wraps to a large negative value — an audible click.
  const restored = pcm16ToFloat(floatToPcm16(Float32Array.from([1.5, -1.5])));
  assert.ok(restored[0] > 0.99, 'positive overshoot stays positive');
  assert.ok(restored[1] < -0.99, 'negative overshoot stays negative');
});

test('PCM16 is little-endian', () => {
  const bytes = floatToPcm16(Float32Array.from([1]));
  // 32767 = 0x7FFF -> low byte first.
  assert.deepEqual([...bytes], [0xff, 0x7f]);
});

test('base64 round-trips binary audio exactly', () => {
  const bytes = floatToPcm16(sine(1024, 16000, 300));
  assert.deepEqual([...base64ToBytes(bytesToBase64(bytes))], [...bytes]);
});

test('base64 encoding survives buffers past the call-stack chunk size', () => {
  // 0x8000 is the internal chunk size; spread on a longer array would throw.
  const bytes = new Uint8Array(0x8000 * 2 + 5).map((_, i) => i % 256);
  const restored = base64ToBytes(bytesToBase64(bytes));
  assert.equal(restored.length, bytes.length);
  assert.deepEqual([...restored.subarray(-5)], [...bytes.subarray(-5)]);
});

test('malformed and empty inputs yield empty output, never a throw', () => {
  assert.equal(resampleMono(null, 48000, 16000).length, 0);
  assert.equal(resampleMono(new Float32Array(0), 48000, 16000).length, 0);
  assert.equal(floatToPcm16(null).length, 0);
  assert.equal(
    pcm16ToFloat(new Uint8Array(1)).length,
    0,
    'a half sample is dropped',
  );
  assert.equal(bytesToBase64(new Uint8Array(0)), '');
  assert.equal(base64ToBytes('not!valid!base64').length, 0);
  assert.equal(base64ToBytes(null).length, 0);
});

test('a byte view with an offset decodes from its own region', () => {
  // pcm16ToFloat takes a DataView over the subarray; ignoring byteOffset here
  // would silently decode the wrong samples.
  const backing = new Uint8Array([0, 0, 0xff, 0x7f]);
  const view = backing.subarray(2);
  const samples = pcm16ToFloat(view);
  assert.equal(samples.length, 1);
  assert.ok(samples[0] > 0.99, 'reads 0x7FFF from the offset region');
});
