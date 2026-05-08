/**
 * STREAM H — Motor audio
 *
 * Looped motor sample, playbackRate driven by state.rpm:
 *   playbackRate = 0.6 + rpm * 1.4
 * Initialized lazily on first user gesture (iOS autoplay policy).
 * Subscribes to 'gateCleared' for a short blip cue.
 */
export {};
