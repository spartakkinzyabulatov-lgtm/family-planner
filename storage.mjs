import {encrypt,decrypt} from './vault.mjs';

export async function updateVault({storage,locks,name,salt,key,initial,guard=()=>true}, transform) {
  if (!locks) throw new Error('Для надёжного сохранения обновите браузер до актуальной версии');
  return locks.request(name, async()=>{
    if(!guard()) return null;
    const raw=storage.getItem(name);
    let current=initial;
    if(raw) {
      const envelope=JSON.parse(raw);
      if(envelope.salt!==salt) throw new Error('Список был открыт заново в другой вкладке. Обновите страницу');
      current=await decrypt(key,envelope);
    }
    const next=transform(current);
    const envelope={version:1,salt,...await encrypt(key,next)};
    if(!guard()) return null;
    storage.setItem(name,JSON.stringify(envelope));
    return next;
  });
}
