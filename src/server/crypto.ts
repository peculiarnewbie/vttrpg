const encoder = new TextEncoder();

const toBase64 = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

const ITERATIONS = 100_000;

const derive = async (password: string, salt: Uint8Array) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
};

export const hashPassword = async (password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt);
  return { hash: toBase64(bits), salt: toBase64(salt) };
};

const timingSafeEqual = (a: string, b: string) => {
  const left = fromBase64(a);
  const right = fromBase64(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
};

export const verifyPassword = async (password: string, hash: string, salt: string) => {
  try {
    const bits = await derive(password, fromBase64(salt));
    return timingSafeEqual(toBase64(bits), hash);
  } catch {
    return false;
  }
};

export const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes).replace(/[^a-zA-Z0-9]/g, "");
};

export const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

export const nowIso = () => new Date().toISOString();

export const slugify = (input: string) =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "world";
