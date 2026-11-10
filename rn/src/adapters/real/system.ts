import { randomUUID } from 'expo-crypto';
import type { Clock, IdSource } from '../../core/ports';
import { toIsoSeconds } from '../../core/time';

export const systemClock: Clock = { now: () => toIsoSeconds(new Date()) };
export const cryptoIds: IdSource = { uuid: () => randomUUID() };
