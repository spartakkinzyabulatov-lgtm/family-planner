const encoder = new TextEncoder();
const base64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export const randomSalt = () => base64(crypto.getRandomValues(new Uint8Array(16)));
export async function deriveKey(pin, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt:bytes(salt), iterations:300000, hash:'SHA-256'}, material, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
export async function encrypt(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, encoder.encode(JSON.stringify(value))));
  // Chunking avoids exceeding the function-argument limit for a large family list.
  let binary = '';
  for (let start=0; start<cipher.length; start+=8192) binary += String.fromCharCode(...cipher.subarray(start,start+8192));
  return {iv:base64(iv), cipher:btoa(binary)};
}
export async function decrypt(key, value) {
  const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv)}, key, bytes(value.cipher));
  return JSON.parse(new TextDecoder().decode(plain));
}
