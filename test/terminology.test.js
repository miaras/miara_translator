import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTerms,formatTerms,mergeTerms} from '../terminology.js';
test('custom terminology parses multilingual pairs, rejects incomplete or oversized entries, and survives formatting',()=>{
 const terms=parseTerms('Shiroko = 시로코\n\n memory = 메모리\nShiroko = 쉬로코');
 assert.deepEqual(terms,{Shiroko:'쉬로코',memory:'메모리'});assert.deepEqual(parseTerms(formatTerms(terms)),terms);
 for(const text of ['missing delimiter','source =','= target','x'.repeat(201)+' = y',Array.from({length:501},(_,i)=>`term${i} = value`).join('\n')])assert.throws(()=>parseTerms(text));
});
test('custom terms override extracted terms and stay pinned when a dictionary reaches the API limit',()=>{
 const extracted=Object.fromEntries(Array.from({length:700},(_,i)=>[`term${i}`,'auto']));
 const merged=mergeTerms(extracted,{term0:'preferred',name:'이름'});assert.equal(Object.keys(merged).length,500);assert.equal(merged.term0,'preferred');assert.equal(merged.name,'이름');
 const custom=Object.fromEntries(Array.from({length:500},(_,i)=>['custom'+i,'x']));assert.deepEqual(mergeTerms(extracted,custom),custom);
 assert.equal(parseTerms('__proto__ = safe').__proto__,'safe');
});
