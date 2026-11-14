// Khóa app: mã PIN (chỉ lưu dạng băm PBKDF2, không lưu PIN gốc) + sinh trắc học qua WebAuthn.
import { getKV, setKV } from './db.js';

const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
  return b64(bits);
}

export async function hasPin() { return !!(await getKV('pin')); }

export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await setKV('pin', { salt: b64(salt), hash: await hashPin(pin, salt) });
}
export async function clearPin() { await setKV('pin', null); await setKV('bio', null); }

export async function checkPin(pin) {
  const p = await getKV('pin');
  if (!p) return true;
  return (await hashPin(pin, unb64(p.salt))) === p.hash;
}

export async function bioAvailable() {
  try {
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) { return false; }
}
export async function hasBio() { return !!(await getKV('bio')); }

export async function enableBio(label) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: label },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'local-user', displayName: label },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none',
    },
  });
  await setKV('bio', { id: b64(cred.rawId) });
}
export async function disableBio() { await setKV('bio', null); }

export async function unlockWithBio() {
  const b = await getKV('bio');
  if (!b) return false;
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: unb64(b.id) }],
        userVerification: 'required', timeout: 60000,
      },
    });
    return !!res && res.response && (new Uint8Array(res.response.authenticatorData)[32] & 0x04) !== 0; // cờ "đã xác minh người dùng"
  } catch (e) { return false; }
}
