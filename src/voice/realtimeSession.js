import { GevRealtimeController } from './realtimeController.js';
import { GeminiRealtimeConnection } from './geminiConnection.js';

/** Adapt the Gemini Live transport to the common voice session. */
export function createRealtimeSession({
  emit,
  runAction,
  createController = (options) => new GevRealtimeController(options),
  ...options
}) {
  const controller = createController({
    ...options,
    actionExecutor: runAction,
    onSessionEvent: emit,
    connectionClass: GeminiRealtimeConnection,
  });

  return {
    controller,
    capabilities: { pushToTalk: true },
    start: (settings) => controller.start(settings),
    stop: (settings) => controller.stop(settings),
    sendText: (text) => controller.sendTextCommand(text),
    sendMapEvent: (event) => controller.notifyMapEvent(event),
    ignoreButtonClick: () => Boolean(controller.spaceKeyHeld),
    bindControls() {
      controller.bindPushToTalkShortcut();
    },
  };
}
