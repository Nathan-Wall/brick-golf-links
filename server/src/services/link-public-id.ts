import { customAlphabet } from 'nanoid';

export const LINK_PUBLIC_ID_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
export const LINK_PUBLIC_ID_LENGTH = 16;
export const LINK_SUBTRACKER_ID_LENGTH = 10;
export const GENERATED_LINK_SLUG_LENGTH = 6;
export const LINK_PUBLIC_ID_PATTERN = new RegExp(
  `^[${LINK_PUBLIC_ID_ALPHABET.replace('-', '\\-')}]{${LINK_PUBLIC_ID_LENGTH}}$`
);
export const LINK_SUBTRACKER_ID_PATTERN = new RegExp(
  `^[${LINK_PUBLIC_ID_ALPHABET.replace('-', '\\-')}]{${LINK_SUBTRACKER_ID_LENGTH}}$`
);

const generateLinkPublicId = customAlphabet(LINK_PUBLIC_ID_ALPHABET, LINK_PUBLIC_ID_LENGTH);
const generateLinkSubtrackerId = customAlphabet(
  LINK_PUBLIC_ID_ALPHABET,
  LINK_SUBTRACKER_ID_LENGTH
);
const generateLinkSlug = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', GENERATED_LINK_SLUG_LENGTH);

export function createLinkPublicId() {
  return generateLinkPublicId();
}

export function createLinkSubtrackerId() {
  return generateLinkSubtrackerId();
}

export function createGeneratedLinkSlug() {
  return generateLinkSlug();
}
