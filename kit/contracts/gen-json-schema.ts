import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import * as s from './schemas.ts';
const out: Record<string, unknown> = {};
for (const [name, v] of Object.entries(s)) if (v instanceof z.ZodType) out[name] = z.toJSONSchema(v);
for (const [name, v] of Object.entries(s.ValueByType)) out[`Value_${name}`] = z.toJSONSchema(v);
writeFileSync(new URL('./json-schema.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('wrote', Object.keys(out).length, 'schemas');
