import * as bridge from "./bridge";

// Persist a bounded replay buffer per PTY so scrollback can be reconstructed
// after a TerminalView unmounts (for example, when switching tabs or
// environments) without keeping every xterm instance mounted indefinitely.
const MAX_BUFFERED_BYTES = 1024 * 1024;

type OutputListener = (bytes: Uint8Array) => void;
type BufferedOutput = {
  chunks: Uint8Array[];
  totalBytes: number;
};

const activeListeners = new Map<string, Set<OutputListener>>();
const replayBuffers = new Map<string, BufferedOutput>();
let subscriptionPromise: Promise<void> | null = null;

function decodeBase64(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function appendToReplay(ptyId: string, bytes: Uint8Array) {
  if (bytes.byteLength === 0) return;

  const existing = replayBuffers.get(ptyId) ?? { chunks: [], totalBytes: 0 };
  existing.chunks.push(bytes);
  existing.totalBytes += bytes.byteLength;

  while (existing.totalBytes > MAX_BUFFERED_BYTES && existing.chunks.length > 0) {
    const overflow = existing.totalBytes - MAX_BUFFERED_BYTES;
    const firstChunk = existing.chunks[0];
    if (!firstChunk) break;
    if (firstChunk.byteLength <= overflow) {
      existing.chunks.shift();
      existing.totalBytes -= firstChunk.byteLength;
      continue;
    }
    existing.chunks[0] = firstChunk.subarray(overflow);
    existing.totalBytes -= overflow;
  }

  replayBuffers.set(ptyId, existing);
}

function copyReplayBuffer(buffer: BufferedOutput): Uint8Array {
  const merged = new Uint8Array(buffer.totalBytes);
  let offset = 0;
  for (const chunk of buffer.chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function handleOutput(ptyId: string, bytes: Uint8Array) {
  appendToReplay(ptyId, bytes);

  const listeners = activeListeners.get(ptyId);
  if (!listeners || listeners.size === 0) return;
  // Copy to snapshot before iterating so listeners that unsubscribe during
  // callback don't mutate the Set we're walking.
  for (const listener of Array.from(listeners)) {
    listener(bytes);
  }
}

/**
 * Attach the module-level terminal output subscription if it isn't already
 * attached. Safe to call multiple times; subsequent calls return the same
 * Promise. Must be awaited before spawning a PTY so early output reaches the
 * replay buffer instead of being dropped.
 */
export function ensureTerminalOutputBusReady(): Promise<void> {
  if (subscriptionPromise) return subscriptionPromise;
  subscriptionPromise = bridge
    .listenToTerminalOutput((payload) => {
      handleOutput(payload.ptyId, decodeBase64(payload.dataBase64));
    })
    .then(() => undefined)
    .catch((error) => {
      subscriptionPromise = null;
      throw error;
    });
  return subscriptionPromise;
}

/**
 * Register a listener for output from a specific PTY. Any buffered output for
 * that PTY is replayed synchronously before subscribeToTerminalOutput returns
 * so a remounted TerminalView can rebuild its scrollback. Multiple listeners
 * can coexist for the same ptyId (for example, a TerminalView rendering the
 * output and a localhost URL sniffer running alongside). Returns an
 * unsubscribe function that removes this specific listener.
 */
export function subscribeToTerminalOutput(
  ptyId: string,
  listener: OutputListener,
): () => void {
  let listeners = activeListeners.get(ptyId);
  if (!listeners) {
    listeners = new Set();
    activeListeners.set(ptyId, listeners);
  }
  listeners.add(listener);
  const replay = replayBuffers.get(ptyId);
  if (replay && replay.totalBytes > 0) {
    listener(copyReplayBuffer(replay));
  }
  return () => {
    const set = activeListeners.get(ptyId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      activeListeners.delete(ptyId);
    }
  };
}

/**
 * Drop any buffered output for a ptyId that will never be consumed again
 * (for example, the tab was closed or the PTY was killed). Prevents replay
 * buffers from leaking memory across dead sessions.
 */
export function dropPendingTerminalOutput(ptyId: string): void {
  replayBuffers.delete(ptyId);
}

/**
 * Test-only: reset the bus to a clean state. Used between tests to avoid
 * cross-test contamination of buffers and listener state.
 */
export function __resetTerminalOutputBus(): void {
  activeListeners.clear();
  replayBuffers.clear();
  subscriptionPromise = null;
}
