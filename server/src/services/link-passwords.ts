import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const linkPasswordHashPrefix = 'scrypt';
const linkPasswordSaltBytes = 16;
const linkPasswordKeyLength = 64;

function encodeBuffer(buffer: Buffer) {
  return buffer.toString('base64url');
}

function decodeBuffer(value: string) {
  return Buffer.from(value, 'base64url');
}

function normalizeLinkPassword(password: string) {
  return password.normalize('NFKC');
}

export async function hashLinkPassword(password: string) {
  const salt = encodeBuffer(randomBytes(linkPasswordSaltBytes));
  const derivedKey = (await scrypt(
    normalizeLinkPassword(password),
    salt,
    linkPasswordKeyLength
  )) as Buffer;

  return `${linkPasswordHashPrefix}$${salt}$${encodeBuffer(derivedKey)}`;
}

export async function verifyLinkPassword(password: string, storedHash: string) {
  const [algorithm, salt, expectedHash] = storedHash.split('$');
  if (
    algorithm !== linkPasswordHashPrefix ||
    typeof salt !== 'string' ||
    salt.length === 0 ||
    typeof expectedHash !== 'string' ||
    expectedHash.length === 0
  ) {
    return false;
  }

  const expectedBuffer = decodeBuffer(expectedHash);
  const derivedKey = (await scrypt(
    normalizeLinkPassword(password),
    salt,
    expectedBuffer.length
  )) as Buffer;

  if (derivedKey.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, expectedBuffer);
}

export function getLinkPasswordVerifier(storedHash: string) {
  return createHash('sha256').update(storedHash).digest('base64url').slice(0, 24);
}
