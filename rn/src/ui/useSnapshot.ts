import { useEffect, useMemo, useReducer } from 'react';
import type { AppCore } from '../core/app';
import type { Snapshot } from '../core/types';

/** The Today snapshot, re-read after every core action. */
export function useSnapshot(core: AppCore): Snapshot {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => core.subscribe(bump), [core]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the "core changed" signal
  return useMemo(() => core.snapshot(), [core, version]);
}
