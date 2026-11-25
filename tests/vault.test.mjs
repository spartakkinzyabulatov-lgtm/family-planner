import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveKey, encrypt, decrypt, randomSalt} from '../vault.mjs';

test('encrypted records survive reload and wrong PIN cannot decrypt', async () => {
  const salt = randomSalt();
  const pin = crypto.randomUUID();
  const key = await deriveKey(pin, salt);
  const records = {items:[{title:'Покупка', amount:120050}],pending:[{opId:'one'}],token:'session'};
  const encrypted = await encrypt(key, records);
  assert.equal(JSON.stringify(encrypted).includes('Покупка'),false);
  assert.deepEqual(await decrypt(await deriveKey(pin,salt),encrypted),records);
  await assert.rejects(decrypt(await deriveKey('incorrect',salt),encrypted));
  assert.notEqual((await encrypt(key, records)).iv, encrypted.iv);
});
