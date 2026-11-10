// Stage pack: the data that turns this one codebase into Polly or Premom.
// The pack JSON itself is imported from kit/packs; the kit ships no schema for it, so the shape below
// is the client's one hand-written description of a pack (see README, "Staying in step with the kit").
import { z } from 'zod';
import { Source } from './contracts';

const base = { type: z.string().min(1), sources: z.array(Source) };

const NumberEntry = z.object({ ...base, kind: z.literal('number'), field: z.string().min(1), min: z.number(), max: z.number() });
const EnumEntry = z.object({ ...base, kind: z.literal('enum'), values: z.array(z.string()).min(1) });
const StripEntry = z.object({
  ...base,
  kind: z.literal('strip'),
  levels: z.array(z.object({ level: z.string(), minRatio: z.number() })).min(1),
  numeric: z.object({ requiresEntitlement: z.string() }).nullable(),
});

const CatalogEntry = z.discriminatedUnion('kind', [NumberEntry, EnumEntry, StripEntry]);

const PackSchema = z.object({
  packId: z.string().min(1),
  appName: z.string().min(1),
  catalog: z.array(CatalogEntry),
  products: z.array(z.object({ productId: z.string(), entitlement: z.string() })),
});

export type Pack = z.infer<typeof PackSchema>;
export type CatalogEntry = z.infer<typeof CatalogEntry>;
export type NumberEntry = z.infer<typeof NumberEntry>;
export type EnumEntry = z.infer<typeof EnumEntry>;
export type StripEntry = z.infer<typeof StripEntry>;

/** Validates raw pack JSON. Throws when the pack is malformed: a broken pack must not start an app. */
export function parsePack(json: unknown): Pack {
  return PackSchema.parse(json);
}

export function findEntry(pack: Pack, type: string): CatalogEntry | undefined {
  return pack.catalog.find((entry) => entry.type === type);
}

export function findProduct(pack: Pack, productId: string) {
  return pack.products.find((product) => product.productId === productId);
}

/** The key inside an observation's `value` object for this catalog entry. */
export function valueField(entry: CatalogEntry): string {
  if (entry.kind === 'number') return entry.field;
  if (entry.kind === 'enum') return 'code';
  return 'ratio';
}

/** The pack level with the highest minRatio that is <= ratio (null when the ratio is below every level). */
export function levelFor(entry: StripEntry, ratio: number): string | null {
  let best: { level: string; minRatio: number } | null = null;
  for (const candidate of entry.levels) {
    if (candidate.minRatio <= ratio && (best === null || candidate.minRatio > best.minRatio)) best = candidate;
  }
  return best ? best.level : null;
}
