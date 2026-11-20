// space.js for sync.js under synclib.mjs: one signed-in account (UID) — W.space, when set, is whose
// data the device shows instead (another tab signed out: a pass must stop writing).
import { UID, W } from './world.mjs';
export const SYNC_META = 'resonate.sync';
export const activeSpace = () => W.space ?? UID;
