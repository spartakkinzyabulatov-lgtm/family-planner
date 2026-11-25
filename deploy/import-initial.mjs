// Private input stays outside the public checkout. PIN is read through an un-echoed terminal prompt.
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {deriveKey,decrypt} from '../vault.mjs';

const [filename,endpoint]=process.argv.slice(2);
if(!filename||!endpoint) throw new Error('Usage: node deploy/import-initial.mjs <encrypted-file> <https-api-base|--check>');
const prompt=spawnSync('python3',['-c','import getpass; print(getpass.getpass("Семейный PIN: "))'],{stdio:['inherit','pipe','inherit'],encoding:'utf8'});
if(prompt.status!==0) throw new Error('PIN entry was cancelled');
const pin=prompt.stdout.trim();
const envelope=JSON.parse(await fs.readFile(filename,'utf8'));
const data=await decrypt(await deriveKey(pin,envelope.salt),envelope);
const known=data.operations.reduce((sum,op)=>sum+(op.changes.amount??0),0)/100;
if(endpoint==='--check') console.log(JSON.stringify({records:data.operations.length,knownTotalRubles:known,encrypted:true}));
else {
  if(!endpoint.startsWith('https://')) throw new Error('Production import requires HTTPS');
  const api=endpoint.replace(/\/$/,'');
  const authResponse=await fetch(api+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin}),signal:AbortSignal.timeout(20000)});
  if(!authResponse.ok) throw new Error('Unable to authorize private import: '+authResponse.status);
  const {token}=await authResponse.json();
  const response=await fetch(api+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({operations:data.operations}),signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error('Import was not confirmed: '+response.status);
  const result=await response.json();
  if(result.acknowledged.length!==data.operations.length) throw new Error('Partial import; inspect before proceeding');
  console.log(JSON.stringify({imported:result.acknowledged.length,knownTotalRubles:known}));
}
