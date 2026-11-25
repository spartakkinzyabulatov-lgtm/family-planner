import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateVault} from '../storage.mjs';
import {deriveKey,randomSalt,encrypt,decrypt} from '../vault.mjs';

test('two stale tabs append to the latest encrypted queue without dropping operations', async()=>{
  const salt=randomSalt(), key=await deriveKey(crypto.randomUUID(),salt);
  let raw=JSON.stringify({salt,...await encrypt(key,{pending:[],token:'session'})});
  const storage={getItem:()=>raw,setItem:(_,value)=>{raw=value;}};
  let chain=Promise.resolve();
  const locks={request:(_name,action)=>{const result=chain.then(action);chain=result.catch(()=>{});return result;}};
  await Promise.all(['one','two'].map(id=>updateVault({storage,locks,name:'test',salt,key},current=>({...current,pending:[...current.pending,{id}]}))));
  assert.deepEqual((await decrypt(key,JSON.parse(raw))).pending,[{id:'one'},{id:'two'}]);
});
