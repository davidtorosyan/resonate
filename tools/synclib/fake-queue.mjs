// omr/queue.js for sync.js under synclib.mjs: the device's conversion queue (W.dev.queue, song ids).
import { W } from './world.mjs';
export function dropFromQueue(id) {
  const q = W.dev.queue;
  if (!q.includes(id)) return false;
  W.dev.queue = q.filter((x) => x !== id);
  return true;
}
