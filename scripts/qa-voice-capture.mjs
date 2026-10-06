#!/usr/bin/env node
/**
 * Browser proof for the Gemini voice microphone capture path.
 *
 * `startAudioCapture` is the one part of the voice stack that cannot be unit
 * tested: it needs getUserMedia, an AudioContext and an AudioWorklet loaded
 * from a Blob URL. Chrome's fake media device supplies a synthetic
 * microphone, so this runs the real module and asserts the contract the
 * transport depends on — that audio is produced, that the push-to-talk gate
 * actually STOPS the stream (a muted track still yields silent frames, which
 * would stream forever), that stop() ends it, and that the bytes leaving the
 * encoder are well-formed 16 kHz PCM16.
 *
 * Requires a dev server: `npm run dev`, then `npm run qa:voice-capture`.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { base64ToBytes, pcm16ToFloat } from '../src/voice/geminiAudio.js';
import { GEMINI_INPUT_SAMPLE_RATE } from '../src/voice/geminiProtocol.js';

const appUrl = process.env.QA_BASE_URL || 'http://localhost:4173';
const headful = process.argv.includes('--headful');
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (await puppeteer.executablePath().catch(() => null));

if (!executablePath || !fs.existsSync(executablePath)) {
  throw new Error('Puppeteer Chrome for Testing is unavailable');
}

/** Decode every emitted chunk and describe the signal as a whole. */
function analyse(chunks) {
  let peak = 0;
  let sum = 0;
  let total = 0;
  let evenBytes = true;
  for (const chunk of chunks) {
    const bytes = base64ToBytes(chunk);
    if (bytes.length % 2 !== 0) evenBytes = false;
    for (const value of pcm16ToFloat(bytes)) {
      const amplitude = Math.abs(value);
      if (amplitude > peak) peak = amplitude;
      sum += value * value;
      total += 1;
    }
  }
  return { peak, rms: Math.sqrt(sum / (total || 1)), total, evenBytes };
}

const browser = await puppeteer.launch({
  headless: headful ? false : 'new',
  executablePath,
  args: [
    // A synthetic microphone, auto-granted: no hardware, no permission prompt.
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const failures = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) =>
    failures.push(`page error: ${error.message}`),
  );
  await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const result = await page.evaluate(async () => {
    const module = await import('/src/voice/geminiAudio.js');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    const audioContext = new AudioContext();
    const chunks = [];
    const capture = await module.startAudioCapture({
      stream,
      audioContext,
      onChunk: (chunk) => chunks.push(chunk),
    });

    const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await settle(1200);
    const captured = chunks.length;

    capture.setEnabled(false);
    const atGate = chunks.length;
    await settle(600);
    const whileGated = chunks.length - atGate;

    capture.setEnabled(true);
    await settle(500);
    const afterResume = chunks.length - atGate - whileGated;

    capture.stop();
    const atStop = chunks.length;
    await settle(400);
    const afterStop = chunks.length - atStop;

    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();
    return {
      sampleRate: audioContext.sampleRate,
      captured,
      whileGated,
      afterResume,
      afterStop,
      chunks,
    };
  });

  const signal = analyse(result.chunks);
  // A worklet block is 128 frames; at 48 kHz that is floor(128 / 3) = 42
  // samples once resampled to Gemini's 16 kHz input rate.
  const perChunk = signal.total / (result.chunks.length || 1);
  const expectedPerChunk = Math.floor(
    128 / (result.sampleRate / GEMINI_INPUT_SAMPLE_RATE),
  );

  console.log(`AudioContext rate      : ${result.sampleRate} Hz`);
  console.log(`chunks captured        : ${result.captured}`);
  console.log(`chunks while gated off : ${result.whileGated}`);
  console.log(`chunks after resume    : ${result.afterResume}`);
  console.log(`chunks after stop()    : ${result.afterStop}`);
  console.log(
    `samples per chunk      : ${perChunk.toFixed(2)} (expect ${expectedPerChunk})`,
  );
  console.log(
    `peak / rms             : ${signal.peak.toFixed(4)} / ${signal.rms.toFixed(4)}`,
  );

  const expect = (name, pass) => {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) failures.push(name);
  };
  expect('worklet produced audio', result.captured > 0);
  expect('gate stops the stream', result.whileGated === 0);
  expect('gate resumes the stream', result.afterResume > 0);
  expect('stop() ends the stream', result.afterStop === 0);
  expect(
    'every chunk is whole PCM16 samples',
    signal.total > 0 && signal.evenBytes,
  );
  expect(
    'resampled to the Gemini input rate',
    Math.abs(perChunk - expectedPerChunk) < 1,
  );
  expect('captured signal is not silence', signal.peak > 0.0005);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nqa:voice-capture FAILED\n - ${failures.join('\n - ')}`);
  process.exitCode = 1;
} else {
  console.log('\nqa:voice-capture passed');
}
