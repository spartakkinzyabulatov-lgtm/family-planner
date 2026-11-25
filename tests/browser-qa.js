async (page) => {
  const qaContext=await page.context().browser().newContext({viewport:{width:375,height:812}});
  page=await qaContext.newPage();
  let stage='startup';
  try {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.context().setOffline(false);
  await page.setViewportSize({width:375,height:812});
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const login=async p=>{await p.getByLabel('Семейный пароль').fill('000000');await p.getByRole('button',{name:'Открыть наш список'}).click();await p.getByRole('heading',{name:'Наши планы.'}).waitFor();};
  const add=async(p,title,amount='',month='')=>{await p.locator('.mobile-add').click();await p.getByLabel('Что нужно купить или оплатить').fill(title);await p.getByLabel('Сумма, ₽').fill(amount);await p.getByLabel('Месяц планирования').fill(month);await p.getByRole('button',{name:'Сохранить в наши планы'}).click();await p.getByRole('button',{name:'Редактировать: '+title,exact:true}).waitFor();};
  const synced=async p=>p.waitForFunction(()=>document.getElementById('sync-label').textContent==='Общий список обновлён');
  stage='initial login';await login(page);
  await add(page,'Покупка в декабре','1250,50','2026-12'); await synced(page);
  const otherTab=await page.context().newPage();
  await otherTab.setViewportSize({width:375,height:812});
  await otherTab.goto('http://127.0.0.1:8765/');await login(otherTab);
  const otherContext=await page.context().browser().newContext({viewport:{width:375,height:812}});
  const other=await otherContext.newPage();await other.goto('http://127.0.0.1:8765/');await login(other);
  await other.getByRole('button',{name:'Редактировать: Покупка в декабре',exact:true}).waitFor();
  stage='concurrent fields';
  // Concurrent edits of different fields must preserve both changes.
  await page.getByRole('button',{name:'Редактировать: Покупка в декабре',exact:true}).click();
  await other.getByRole('button',{name:'Отметить выполненным: Покупка в декабре',exact:true}).click();await synced(other);
  await page.getByLabel('Сумма, ₽').fill('1500');await page.getByRole('button',{name:'Сохранить в наши планы'}).click();await synced(page);
  await page.getByRole('tab',{name:'Закрытые'}).click();
  await page.getByRole('button',{name:'Вернуть в планы: Покупка в декабре',exact:true}).click();await synced(page);
  await page.getByRole('tab',{name:'Предстоящие'}).click();
  stage='offline tabs';
  // Two stale tabs write while offline, then survive a reload.
  await page.context().setOffline(true);
  await add(page,'Покупка без интернета','800');
  await add(otherTab,'Запись из второй вкладки','0');
  await page.getByRole('button',{name:'Редактировать: Запись из второй вкладки',exact:true}).waitFor();
  stage='offline reload';await page.reload();await login(page);
  await page.getByRole('button',{name:'Редактировать: Покупка без интернета',exact:true}).waitFor();
  await page.getByRole('button',{name:'Редактировать: Запись из второй вкладки',exact:true}).waitFor();
  await add(other,'Покупка с другого телефона');await synced(other);
  stage='restore network';await page.context().setOffline(false);await synced(page);
  await page.getByRole('button',{name:'Редактировать: Покупка с другого телефона',exact:true}).waitFor();
  await other.getByRole('button',{name:'Общий список обновлён',exact:true}).click();await synced(other);
  await other.getByRole('button',{name:'Редактировать: Покупка без интернета',exact:true}).waitFor();
  stage='503 login';
  // A temporary server failure must not block the verified local copy.
  await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Заблокировать',exact:true}).click();
  await page.route('**/api/login',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Временно недоступно"}'}));
  await login(page);await page.getByRole('button',{name:'Редактировать: Покупка без интернета',exact:true}).waitFor();await page.unroute('**/api/login');
  stage='filters';await page.getByLabel('Месяц',{exact:true}).selectOption('2026-12');
  if(!(await page.locator('#total-amount').innerText()).includes('1 500'))throw new Error('Wrong month total');
  await page.getByLabel('Месяц',{exact:true}).selectOption('all');
  await page.getByPlaceholder('Найти покупку или дело').fill('декабре');
  if(await page.locator('.item-row').count()!==1)throw new Error('Search failed');
  await page.getByPlaceholder('Найти покупку или дело').fill('');
  const width=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
  if(width.viewport!==width.content)throw new Error('Mobile overflow');
  const encrypted=await page.evaluate(()=>!localStorage.getItem('family-planner-v1').includes('Покупка'));
  if(!encrypted)throw new Error('Plaintext storage');
  await otherTab.close();await otherContext.close();
  if(errors.length)throw new Error(errors.join('; '));
  await page.screenshot({path:'.playwright-mcp/family-planner-mobile-verified.png',fullPage:true});
  await qaContext.close();
  return {mobile:width,addEditCheckUndo:true,monthAndSearch:true,twoDevices:true,twoOfflineTabs:true,offlineReload:true,offlineDelivery:true,server503LocalLogin:true,encryptedStorage:true,pageErrors:errors};
  } catch(error) {await qaContext.close();throw new Error(stage+': '+error.message);}
}
