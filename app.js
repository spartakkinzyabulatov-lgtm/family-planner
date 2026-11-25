import {categories, applyOperations, summarize, validateDraft, itemMonth, syncBatch} from './model.mjs';
import {deriveKey, encrypt, decrypt, randomSalt} from './vault.mjs';
import {updateVault} from './storage.mjs';

const $ = id => document.getElementById(id);
const STORAGE = 'family-planner-v1';
const API = (window.FAMILY_CONFIG?.apiBase || '').replace(/\/$/, '');
const money = cents => new Intl.NumberFormat('ru-RU', {style:'currency', currency:'RUB', maximumFractionDigits:2}).format(cents/100);
const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Yekaterinburg'}).format(new Date());
const monthLabel = key => key === 'undated' ? 'Без даты' : new Intl.DateTimeFormat('ru-RU', {month:'long', year:'numeric', timeZone:'UTC'}).format(new Date(key+'-01T12:00:00Z')).replace(' г.','');
const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
let state = null, key = null, salt = null, serial = Promise.resolve(), syncBusy = false, epoch = 0;
let view = 'planned', editingId = null, editingOriginal = null, installPrompt = null, lastError = '', toastTimer;

function notify(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4000);
}
async function request(path, body, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(API + path, {method:'POST', headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})}, body:JSON.stringify(body), signal:controller.signal, cache:'no-store', credentials:'omit'});
    let data;
    try { data = await response.json(); } catch { throw new Error('Сервис пока недоступен. Попробуйте позже'); }
    if (!response.ok) { const error = new Error(data.error || 'Не удалось связаться с общим списком'); error.status = response.status; throw error; }
    return data;
  } finally { clearTimeout(timer); }
}
// Every write derives its new value from the latest state, then commits only after encryption and storage succeed.
function changeState(transform) {
  const myEpoch = epoch;
  const operation = serial.catch(() => {}).then(async () => {
    if (!key || !state || epoch !== myEpoch) return;
    const next=await updateVault({storage:localStorage,locks:navigator.locks,name:STORAGE,salt,key,initial:state,guard:()=>epoch===myEpoch},transform);
    if(next&&epoch===myEpoch) {state=next;render();}
  });
  serial = operation;
  return operation;
}
function visibleItems() { return applyOperations(state?.items || [], state?.pending || []); }
function showApp() {
  $('pin').value = ''; $('login-screen').hidden = true; $('app-screen').hidden = false;
  $('today-label').textContent = new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Yekaterinburg'}).format(new Date()).replace(' г.','') + ' · НАШ ОБЩИЙ СПИСОК';
  render();
}
function renderStatus() {
  if (!state) return;
  let text;
  const pending = state.pending.length;
  $('sync-status').className = 'sync-status';
  if (!navigator.onLine) { text = pending ? `Без сети · ждут ${pending}` : 'Без сети · сохранено'; $('sync-status').classList.add('offline'); }
  else if (syncBusy) text = 'Синхронизируем';
  else if (lastError) { text = lastError; $('sync-status').classList.add('problem'); }
  else if (pending) { text = `На телефоне · ждут ${pending}`; $('sync-status').classList.add('offline'); }
  else text = state.lastSync ? 'Общий список обновлён' : 'Подключаемся';
  $('sync-label').textContent = text;
  $('sync-status').title = lastError || (pending ? 'Изменения сохранены на этом устройстве и ждут отправки' : 'Обновить общий список');
  $('footer-status').textContent = pending ? `${pending} изм. ждут отправки семье` : 'Зашифровано на этом устройстве';
  $('settings-sync').textContent = `${pending ? 'Ожидают отправки: '+pending+'. ' : ''}${state.lastSync ? 'Последнее обновление: '+new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short',timeZone:'Asia/Yekaterinburg'}).format(new Date(state.lastSync)) : 'Общий список ещё не загружен.'}`;
}
function render() {
  if (!state) return;
  const items = visibleItems();
  const selected = $('month-filter').value;
  const months = [...new Set(items.map(itemMonth))].sort((a,b)=>a==='undated'?1:b==='undated'?-1:a.localeCompare(b));
  $('month-filter').innerHTML = '<option value="all">Все месяцы</option>' + months.map(month=>`<option value="${month}">${escape(monthLabel(month))}</option>`).join('');
  $('month-filter').value = selected === 'all' || months.includes(selected) ? selected : 'all';
  const month = $('month-filter').value;
  const scoped = items.filter(item => month === 'all' || itemMonth(item) === month);
  const summary = summarize(scoped), completed = scoped.filter(item=>item.done).length;
  $('total-amount').textContent = money(summary.total);
  $('total-caption').textContent = month === 'all' ? 'Предстоит потратить' : 'Расходы · '+monthLabel(month);
  $('unknown-caption').textContent = summary.unknown ? `Ещё ${summary.unknown} без суммы · уточним позже` : summary.count ? 'Сумма предстоящих покупок' : 'Добавьте первую покупку — посчитаем вместе';
  $('planned-count').textContent = summary.count; $('done-count').textContent = completed;
  $('planned-tab-count').textContent = summary.count; $('done-tab-count').textContent = completed;
  for (const tab of ['planned','done']) { $('tab-'+tab).classList.toggle('active', view===tab); $('tab-'+tab).setAttribute('aria-selected', String(view===tab)); }
  const query = $('search').value.trim().toLocaleLowerCase('ru');
  const filtered = scoped.filter(item => Boolean(item.done)===(view==='done') && `${item.title} ${item.note}`.toLocaleLowerCase('ru').includes(query));
  const groups = new Map();
  filtered.sort((a,b)=>(itemMonth(a)==='undated'?'9999':itemMonth(a)).localeCompare(itemMonth(b)==='undated'?'9999':itemMonth(b)) || (a.date||'9999').localeCompare(b.date||'9999') || (a.createdAt||'').localeCompare(b.createdAt||''));
  for (const item of filtered) { const m=itemMonth(item); if(!groups.has(m)) groups.set(m,[]); groups.get(m).push(item); }
  if (!filtered.length) {
    const empty = query ? ['Ничего не нашли','Попробуйте другое название или уберите поиск.'] : view==='done' ? ['Здесь будут закрытые покупки','Поставьте галочку рядом с тем, что уже купили или оплатили.'] : ['Пусть голова отдыхает','Добавьте покупку или будущий расход. Дату и сумму можно уточнить позже.'];
    $('items-container').innerHTML = `<div class="empty-state"><span class="empty-icon">${icon(view==='done'?'check':'bag')}</span><h2>${empty[0]}</h2><p>${empty[1]}</p>${!query&&view==='planned'?'<button class="button secondary" data-add>Добавить первую покупку</button>':''}</div>`;
  } else {
    $('items-container').innerHTML = [...groups].map(([month, rows])=>`<section><div class="group-header"><h2>${escape(monthLabel(month))}</h2><span>${money(rows.reduce((sum,item)=>sum+(item.amount??0),0))}${rows.some(item=>item.amount==null)?' + уточнить':''}</span></div><div class="item-group">${rows.map(item=>{
      const overdue = item.date && item.date < today() && !item.done;
      const dateText = item.date ? new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(item.date+'T12:00:00Z')) : 'Дату уточним';
      return `<article class="item-row${item.done?' done':''}"><button class="check-button" data-toggle="${escape(item.id)}" aria-label="${item.done?'Вернуть в планы':'Отметить выполненным'}: ${escape(item.title)}" aria-pressed="${Boolean(item.done)}">${item.done?icon('check'):''}</button><button class="item-main" data-edit="${escape(item.id)}" aria-label="Редактировать: ${escape(item.title)}"><span class="item-title">${escape(item.title)}</span><span class="item-meta"><span class="category-tag" data-category="${escape(item.category)}">${escape(item.category)}</span><span class="item-date${overdue?' overdue':''}">${escape(dateText)}${overdue?' · срок прошёл':''}</span>${item.note?`<span class="item-note">· ${escape(item.note)}</span>`:''}</span></button><button class="item-price${item.amount==null?' unknown':''}" data-edit="${escape(item.id)}" aria-label="Изменить сумму: ${escape(item.title)}">${item.amount==null?'Уточнить сумму':escape(money(item.amount))}</button></article>`;
    }).join('')}</div></section>`).join('');
  }
  renderStatus();
}
async function sync(manual=false) {
  if (!state || syncBusy) return;
  if (!navigator.onLine) { renderStatus(); if(manual) notify('Без интернета. Изменения сохранены на телефоне'); return; }
  syncBusy = true; lastError = ''; renderStatus();
  const myEpoch = epoch;
  try {
    do {
      const batch = syncBatch(state.pending);
      const response = await request('/api/sync', {operations:batch}, state.token);
      if (!state || myEpoch !== epoch) return;
      const acknowledged = new Set(response.acknowledged);
      await changeState(current => ({...current,items:response.revision>=(current.revision||0)?response.items:current.items,revision:Math.max(current.revision||0,response.revision),pending:current.pending.filter(op=>!acknowledged.has(op.opId)),lastSync:new Date().toISOString()}));
    } while (state && myEpoch===epoch && state.pending.length);
    if(manual) notify('Общий список обновлён');
  } catch (error) {
    if (myEpoch !== epoch) return;
    lastError = error.status===401 ? 'Войдите снова' : error.status===400 ? 'Проверьте запись' : 'Связь недоступна';
    if (manual) notify(error.status ? error.message : 'Изменения сохранены на телефоне. Повторим отправку позже');
  } finally {
    syncBusy = false; if(state) renderStatus();
  }
}
async function queue(id, changes) {
  await changeState(current=>({...current,pending:[...current.pending,{opId:crypto.randomUUID(),id,changes}]}));
  void sync();
}
function openItem(id=null) {
  const item = id ? visibleItems().find(item=>item.id===id) : null;
  editingId = id; editingOriginal = item ? {...item} : null;
  $('item-form').reset(); $('item-error').textContent = '';
  $('item-dialog-title').textContent = item ? 'Изменить покупку' : 'Новая покупка';
  $('item-title').value = item?.title || ''; $('item-amount').value = item?.amount==null ? '' : String(item.amount/100).replace('.',',');
  $('item-date').value = item?.date || ''; $('item-month').value = item?.month || item?.date?.slice(0,7) || ''; $('item-category').value = item?.category || 'Другое'; $('item-note').value = item?.note || '';
  $('item-dialog').showModal();
}
$('item-category').innerHTML = categories.map(category=>`<option>${category}</option>`).join('');
$('login-form').addEventListener('submit', async event=>{
  event.preventDefault(); $('login-error').textContent = '';
  const button = $('login-button'); button.disabled = true; button.textContent = 'Открываем…';
  const pin = $('pin').value;
  try {
    const saved = localStorage.getItem(STORAGE);
    let unlocked = null, nextKey, nextSalt;
    if(saved) {
      const envelope = JSON.parse(saved); nextSalt = envelope.salt; nextKey = await deriveKey(pin,nextSalt);
      try { unlocked = await decrypt(nextKey,envelope); } catch { /* Server can verify a changed PIN when online. */ }
    }
    if (!unlocked) {
      if(saved) throw new Error('Пароль не подходит к сохранённому списку');
      if(!navigator.onLine) throw new Error('Для первого входа подключитесь к интернету');
      const auth = await request('/api/login',{pin});
      nextSalt = randomSalt(); nextKey = await deriveKey(pin,nextSalt);
      unlocked = {items:[],pending:[],token:auth.token,lastSync:null};
    } else if(navigator.onLine) {
      // Re-verify on entry so expired sessions can be renewed without losing the offline queue.
      try { unlocked.token = (await request('/api/login',{pin})).token; }
      catch(error) { if(error.status&&error.status<500) throw error; }
    }
    unlocked=await updateVault({storage:localStorage,locks:navigator.locks,name:STORAGE,salt:nextSalt,key:nextKey,initial:unlocked},current=>({...current,token:unlocked.token}));
    key=nextKey; salt=nextSalt; state=unlocked; epoch++; lastError=''; showApp(); void sync();
  } catch(error) {
    $('login-error').textContent = error.name==='QuotaExceededError' ? 'Не хватает места на телефоне для сохранения списка' : error.message==='Failed to fetch' || error.name==='AbortError' ? 'Нет связи с общим списком. Проверьте интернет и попробуйте снова' : error.message;
  } finally { button.disabled=false; button.innerHTML='Открыть наш список '+icon('arrow'); }
});
$('item-form').addEventListener('submit',async event=>{
  event.preventDefault(); const button=$('save-item'); button.disabled=true; $('item-error').textContent='';
  try {
    const draft=validateDraft(Object.fromEntries(new FormData($('item-form'))));
    const changes=editingOriginal ? Object.fromEntries(Object.entries(draft).filter(([field,value])=>value!==editingOriginal[field])) : {...draft,done:false};
    if(Object.keys(changes).length) await queue(editingId||crypto.randomUUID(),changes);
    $('item-dialog').close(); notify(editingId?'Покупка обновлена':'Добавлено в наши планы');
  } catch(error) { $('item-error').textContent=error.name==='QuotaExceededError'?'Не хватает места. Покупка пока не сохранена':error.message; }
  finally { button.disabled=false; }
});
document.addEventListener('click',async event=>{
  const target=event.target.closest('button'); if(!target) return;
  if(target.hasAttribute('data-add')) openItem();
  if(target.dataset.close) $(target.dataset.close).close();
  if(target.dataset.edit) openItem(target.dataset.edit);
  if(target.dataset.toggle) {
    target.disabled=true;
    try { const item=visibleItems().find(item=>item.id===target.dataset.toggle); await queue(item.id,{done:!item.done}); notify(item.done?'Вернули в планы':'На одну заботу меньше ✓'); }
    catch { notify('Не удалось сохранить галочку. Попробуйте ещё раз'); target.disabled=false; }
  }
});
for(const name of ['planned','done']) $('tab-'+name).addEventListener('click',()=>{view=name;render();});
$('search').addEventListener('input',render); $('month-filter').addEventListener('change',render);
$('settings-open').addEventListener('click',()=>{$('settings-dialog').showModal();renderStatus();});
$('sync-status').addEventListener('click',()=>{if(lastError==='Войдите снова') void lock();else void sync(true);});
$('manual-sync').addEventListener('click',()=>void sync(true));
async function lock() {
  await serial.catch(()=>{}); epoch++; key=null; state=null; salt=null; lastError='';
  for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('app-screen').hidden=true; $('items-container').innerHTML=''; $('item-form').reset();
  $('login-screen').hidden=false; $('pin').value=''; $('pin').focus();
}
$('lock-button').addEventListener('click',()=>void lock());
$('copy-link').addEventListener('click',async()=>{try { await navigator.clipboard.writeText(location.origin+location.pathname);notify('Ссылка скопирована'); } catch { notify('Скопируйте адрес страницы из строки браузера'); }});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install-button').hidden=false;});
$('install-button').addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install-button').hidden=true;}});
window.addEventListener('online',()=>void sync()); window.addEventListener('offline',renderStatus);
window.addEventListener('storage',event=>{
  if(event.key!==STORAGE||!state||!key) return;
  const myEpoch=epoch;
  const operation=serial.catch(()=>{}).then(async()=>{
    const envelope=JSON.parse(localStorage.getItem(STORAGE));
    if(!envelope||envelope.salt!==salt) throw new Error('Список изменён в другой вкладке. Обновите страницу');
    const latest=await decrypt(key,envelope);
    if(epoch===myEpoch&&state) {state=latest;render();}
  });
  serial=operation;
  operation.catch(()=>notify('Обновите страницу, чтобы открыть изменения из другой вкладки'));
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden) void sync();});
setInterval(()=>{if(!document.hidden) void sync();},20000);
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{if(state)notify('Офлайн-открытие пока недоступно. Обновите страницу при подключённом интернете');});
