export const categories = ['Дом', 'Продукты', 'Здоровье', 'Семья', 'Подарки', 'Другое'];
export function applyOperations(items, operations) {
  const map = new Map(items.map(item => [item.id, {...item}]));
  for (const op of operations) map.set(op.id, {...(map.get(op.id) || {id:op.id, amount:null, date:null, category:'Другое', note:'', done:false}), ...op.changes});
  return [...map.values()];
}
export function summarize(items) {
  return items.filter(item => !item.done).reduce((sum, item) => ({total:sum.total + (item.amount ?? 0), unknown:sum.unknown + (item.amount == null ? 1 : 0), count:sum.count + 1}), {total:0, unknown:0, count:0});
}
export function monthKey(date) { return date ? date.slice(0, 7) : 'undated'; }
export function itemMonth(item) { return item.date ? monthKey(item.date) : item.month || 'undated'; }
export function syncBatch(operations) {
  const batch=[];
  let bytes=32;
  for(const op of operations.slice(0,100)) {
    const size=new TextEncoder().encode(JSON.stringify(op)).length+1;
    if(batch.length&&bytes+size>180000) break;
    batch.push(op); bytes+=size;
  }
  return batch;
}
export function validateDraft(draft) {
  const title = String(draft.title || '').trim();
  if (!title || title.length > 200) throw new Error('Напишите название покупки (до 200 символов)');
  const raw = String(draft.amount ?? '').replace(/\s/g, '').replace(',', '.');
  if (raw && (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) > 1000000000)) throw new Error('Введите сумму от 0 до 1 000 000 000 ₽, не больше двух знаков после запятой');
  const amount = raw ? Math.round(Number(raw) * 100) : null;
  const date = draft.date || null;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(date+'T12:00:00Z').getTime()) || new Date(date+'T12:00:00Z').toISOString().slice(0,10) !== date)) throw new Error('Укажите существующую дату');
  if (!categories.includes(draft.category)) throw new Error('Выберите категорию');
  const note = String(draft.note || '').trim();
  if (note.length > 1000) throw new Error('Комментарий — до 1000 символов');
  const month = date ? date.slice(0,7) : draft.month || null;
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Выберите месяц');
  return {title, amount, date, month, category:draft.category, note};
}
