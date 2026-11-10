// Test-only receipt format: base64url(JSON payload) + "." + hex(HMAC-SHA256(secret, payloadPart)).
import { createHmac } from 'node:crypto';
const SECRET = 'bakeoff-store-secret';
export type ReceiptPayload = { txId: string; userId: string; productId: string; entitlement: string; expiresAt: string };
const sign = (part: string) => createHmac('sha256', SECRET).update(part).digest('hex');
export function makeReceipt(p: ReceiptPayload): string {
  const part = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${part}.${sign(part)}`;
}
export function readReceipt(receipt: string): ReceiptPayload | null {
  const [part, sig] = receipt.split('.');
  if (!part || !sig || sign(part) !== sig) return null;
  try { return JSON.parse(Buffer.from(part, 'base64url').toString()); } catch { return null; }
}
