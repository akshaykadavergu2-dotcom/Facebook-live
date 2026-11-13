import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const KEY_FILE = path.join(DATA_DIR, '.master.key');

let cachedMasterKey: Buffer | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

export function isEnvEncryptionKeySet(): boolean {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  return Boolean(
    raw &&
      raw !== 'replace_with_32_byte_random_hex_secret' &&
      raw !== 'replace_with_64_hex_chars' &&
      raw.length >= 16,
  );
}

function getMasterKey(): Buffer {
  if (cachedMasterKey) {
    return cachedMasterKey;
  }

  const envKey = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (
    envKey &&
    envKey !== 'replace_with_32_byte_random_hex_secret' &&
    envKey !== 'replace_with_64_hex_chars' &&
    envKey.length >= 16
  ) {
    cachedMasterKey = crypto.createHash('sha256').update(envKey).digest();
    return cachedMasterKey;
  }

  ensureDataDir();
  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      cachedMasterKey = Buffer.from(hex, 'hex');
      return cachedMasterKey;
    }
  }

  const generated = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, generated.toString('hex'), { mode: 0o600 });
  cachedMasterKey = generated;
  return cachedMasterKey;
}

export interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

export function encryptSecret(plaintext: string): EncryptedPayload {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

export function decryptSecret(payload: EncryptedPayload | null): string | null {
  if (!payload || !payload.iv || !payload.tag || !payload.ciphertext) {
    return null;
  }
  try {
    const key = getMasterKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(payload.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function maskStreamKey(key: string | null): string {
  if (!key) return '';
  if (key.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(12, key.length - 4))}${key.slice(-4)}`;
}

export function redactSensitive(input: string, secrets: Array<string | null | undefined>): string {
  let output = input;
  for (const secret of secrets) {
    if (secret && secret.trim().length > 0) {
      output = output.split(secret).join('[REDACTED_STREAM_KEY]');
    }
  }
  output = output.replace(/(rtmps?:\/\/[^/\s]+\/rtmp\/)([^\s'"]+)/gi, '$1[REDACTED_STREAM_KEY]');
  return output;
}
