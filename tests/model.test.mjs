import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyOperations, summarize, validateDraft, monthKey, itemMonth, syncBatch} from '../model.mjs';

test('patches from two devices preserve unrelated fields and independent items', () => {
  const result = applyOperations([{id:'a', title:'Покупка', amount:100, done:false}], [
    {id:'a', changes:{done:true}}, {id:'a', changes:{amount:200}}, {id:'b', changes:{title:'Другая'}}
  ]);
  assert.deepEqual(result[0], {id:'a', title:'Покупка', amount:200, done:true});
  assert.equal(result[1].title, 'Другая');
});
test('totals count unknown prices, keep zero, and exclude completed', () => {
  assert.deepEqual(summarize([{amount:10050}, {amount:null}, {amount:0}, {amount:900,done:true}]), {total:10050, unknown:1, count:3});
});
test('strict dates and amounts', () => {
  assert.equal(monthKey('2026-12-01'), '2026-12');
  assert.equal(monthKey(null), 'undated');
  assert.equal(validateDraft({title:'  Покупка ', amount:'1 250,50', date:'2026-12-12', category:'Дом', note:''}).amount, 125050);
  assert.equal(validateDraft({title:'Покупка', amount:'', date:'', category:'Дом', note:''}).amount, null);
  for (const amount of ['-1','1.234','NaN','Infinity','1000000001']) assert.throws(() => validateDraft({title:'Покупка',amount,date:'',category:'Дом',note:''}));
  assert.throws(() => validateDraft({title:'Покупка',amount:'0',date:'2026-02-30',category:'Дом',note:''}));
});
test('planning month without invented due date; exact date takes precedence', () => {
  const draft=validateDraft({title:'Покупка',amount:'',date:'',month:'2026-12',category:'Дом'});
  assert.equal(draft.date,null);
  assert.equal(itemMonth(draft),'2026-12');
  assert.equal(itemMonth({date:'2027-01-15',month:'2026-12'}),'2027-01');
  assert.throws(()=>validateDraft({title:'Покупка',amount:'',date:'',month:'2026-13',category:'Дом'}));
});
test('UTF-8 sync batches fit the API limit even with emoji notes', () => {
  const ops=Array.from({length:100},(_,i)=>({opId:String(i),id:String(i),changes:{title:'Покупка',note:'😀'.repeat(500)}}));
  const batch=syncBatch(ops);
  assert.ok(batch.length>0&&batch.length<100);
  assert.ok(new TextEncoder().encode(JSON.stringify({operations:batch})).length<250000);
});
