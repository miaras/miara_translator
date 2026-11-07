import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('monthly paid allowance covers all speeds, releases failures, preserves credit, and supports cancellation portal',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'shiroko-subscriptions-'));
 const orderFile=path.join(directory,'order.json'),subFile=path.join(directory,'subscription.json');
 const port=32000+Math.floor(Math.random()*20000),base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,['--import','./test/fixtures/billing-network.mjs','server.js'],{env:{...process.env,PORT:String(port),SHIROKO_DATA_FILE:path.join(directory,'store.json'),TEST_ORDER_FILE:orderFile,TEST_SUBSCRIPTION_FILE:subFile,OPENAI_API_KEY:'test',POLAR_ACCESS_TOKEN:'test',POLAR_WEBHOOK_SECRET:'test-secret',POLAR_ENVIRONMENT:'production',POLAR_SUBSCRIPTION_PERSONAL:'personal-product',POLAR_SUBSCRIPTION_PRO:'pro-product',POLAR_TOKEN_TOPUP_5:'topup-product-5',SMTP_PASSWORD:''},stdio:'ignore'});
 let cookie;
 try{
  for(let i=0;i<100;i++){try{await fetch(`${base}/api/me`);break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
  async function call(route,input,headers={}){const r=await fetch(base+route,{method:input?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(input?{body:typeof input==='string'?input:JSON.stringify(input)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const registered=await call('/api/register',{email:'subscription@example.com',password:'long-subscription-password'});cookie=registered.cookie;
  assert.equal((await call('/api/billing')).data.plans.find(x=>x.id==='pro').tokens,650_000);
  assert.equal((await call('/api/billing/subscribe',{planId:'personal'})).status,200);
  assert.equal((await call('/api/billing/subscribe',{planId:'fake'})).status,400);
  const sub={id:'12345678-1234-4123-8123-123456789abc',product_id:'personal-product',customer_id:'customer',customer:{external_id:registered.data.user.id},status:'active',current_period_start:new Date(Date.now()-60_000).toISOString(),current_period_end:new Date(Date.now()+30*86400_000).toISOString(),cancel_at_period_end:false};
  const invoice={id:'22345678-1234-4123-8123-123456789abc',subscription_id:sub.id,product_id:'personal-product',customer:{external_id:registered.data.user.id},paid:true,currency:'usd',net_amount:900,refunded_amount:0,created_at:new Date().toISOString()};
  await writeFile(orderFile,JSON.stringify(invoice));await writeFile(subFile,JSON.stringify(sub));
  async function webhook(type,id){const raw=JSON.stringify({type,data:{id}}),timestamp=String(Math.floor(Date.now()/1000)),signature=createHmac('sha256','test-secret').update(`event.${timestamp}.${raw}`).digest('base64');return call('/api/billing/webhook',raw,{'webhook-id':'event','webhook-timestamp':timestamp,'webhook-signature':`v1,${signature}`});}
  assert.equal((await webhook('subscription.active',sub.id)).status,200);
  assert.equal((await call('/api/billing')).data.subscription.remainingTokens,0);
  await webhook('order.paid',invoice.id);await webhook('order.paid',invoice.id);
  assert.equal((await call('/api/billing')).data.subscription.remainingTokens,50_000);
  assert.equal((await call('/api/billing/subscribe',{planId:'pro'})).status,409);
  const input={mode:'regenerate',text:'Hello.',targetLanguage:'French'};
  for(const speed of ['standard','fast','ultrafast'])assert.equal((await call('/api/translate',{...input,speed})).status,200);
  assert.equal((await call('/api/billing')).data.subscription.remainingTokens,49_982);
  assert.equal((await call('/api/translate',{...input,text:'FAIL_PROVIDER'})).status,502);
  const state=await call('/api/billing');assert.equal(state.data.subscription.remainingTokens,49_982);assert.equal(state.data.balanceMicros,0);
  assert.equal((await call('/api/billing/portal',{})).data.url,'https://polar.sh/portal/test');
  sub.cancel_at_period_end=true;await writeFile(subFile,JSON.stringify(sub));await webhook('subscription.canceled',sub.id);
  assert.equal((await call('/api/billing')).data.subscription.remainingTokens,49_982);
  sub.ended_at=new Date(Date.now()-1000).toISOString();sub.status='canceled';await writeFile(subFile,JSON.stringify(sub));await webhook('subscription.revoked',sub.id);
  assert.equal((await call('/api/translate',input)).status,402);
  assert.equal((await call('/api/billing/topup',{amount:5})).status,200);
  invoice.id='32345678-1234-4123-8123-123456789abc';invoice.product_id='topup-product-5';invoice.subscription_id=null;invoice.net_amount=500;await writeFile(orderFile,JSON.stringify(invoice));await webhook('order.paid',invoice.id);
  assert.equal((await call('/api/billing')).data.subscription.prepaidTokens,20_000);
  await call('/api/translate',input);
  assert.equal((await call('/api/billing')).data.subscription.prepaidTokens,19_998);
 }finally{server.kill();await new Promise(resolve=>server.once('exit',resolve));await rm(directory,{recursive:true,force:true});}
});
