// omr/jobs.js for sync.js under synclib.mjs: the device's stored conversions (W.dev.jobs: { id, replace }).
import { W } from './world.mjs';
export async function deleteJobsFor(songId) {
  const gone = W.dev.jobs.filter((j) => j.replace === songId);
  W.dev.jobs = W.dev.jobs.filter((j) => j.replace !== songId);
  return gone.length;
}
