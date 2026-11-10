// The contract registry is IMPORTED from the kit, never copied. Everything the client knows about
// wire shapes (observations, sync, entitlements, analytics) comes through this file.
import type { z } from 'zod';
import * as kit from '../../../kit/contracts/schemas';

export const {
  AnalyticsEvent,
  MAX_MUTATIONS_PER_PUSH,
  PullResponse,
  PushRequest,
  PushResponse,
  Source,
  VerifyError,
  VerifyRequest,
  VerifyResponse,
  validateObservationBody,
} = kit;

export type Source = z.infer<typeof kit.Source>;
export type ObservationBody = kit.ObservationBody;
export type ServerObservation = kit.Observation;
export type Mutation = z.infer<typeof kit.Mutation>;
export type MutationResult = z.infer<typeof kit.MutationResult>;
export type Entitlement = z.infer<typeof kit.Entitlement>;
export type AnalyticsEvent = z.infer<typeof kit.AnalyticsEvent>;
