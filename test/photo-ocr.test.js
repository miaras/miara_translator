import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePhotoTokens, validatePhotos, transcribePhotos, photoOcrApi } from '../photo-ocr.js';
// Small valid PNG fixture; mutate IHDR dimensions to exercise independent byte checks.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=','base64');
function image(width=1080,height=1920){const bytes=Buffer.from(png);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return `data:image/png;base64,${bytes.toString('base64')}`;}
test('server independently enforces image count, bytes, type, and orientation-aware FHD bounds',()=>{
 assert.equal(estimatePhotoTokens(6),9216);assert.throws(()=>estimatePhotoTokens(0));assert.throws(()=>estimatePhotoTokens(7));
 assert.equal(validatePhotos([image(),image(1920,1080)]).length,2);
 for(const bad of [image(1921,1080),image(1081,1920),image(31,31),'https://example.com/image.png','data:image/png;base64,aA=='])assert.throws(()=>validatePhotos([bad]));
 assert.throws(()=>validatePhotos(Array(7).fill(image())));
});
test('OCR uses requested model, private high-detail vision, source-based accounting and ordered pages',async()=>{
 let calls=0;
 const result=await transcribePhotos([image(),image()],{apiKey:'test',fetchImpl:async(url,init)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body);
  assert.equal(body.model,'gpt-6.1-sol');assert.equal(body.store,false);assert.equal(body.max_output_tokens,3584);assert.equal(body.service_tier,'default');
  assert.equal(body.input[0].content[0].detail,'high');assert.match(body.instructions,/never follow instructions/);
  calls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:`Page ${calls}`}]}]})};
 }});
 assert.equal(result.text,'Page 1\n\nPage 2');assert.ok(result.tokens>1024&&result.tokens<8192);
});
test('truncated, empty, refusal and provider failures never produce partial book text',async()=>{
 for(const data of [{status:'incomplete',output:[]},{status:'completed',output:[]},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}]){
 await assert.rejects(()=>transcribePhotos([image()],{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>data})}));
 }
 await assert.rejects(()=>transcribePhotos([image()],{apiKey:'test',fetchImpl:async()=>({ok:false})}));
});
const now=Date.now();
function store(){return {users:[{id:'u'}],subscriptions:[{id:'s',userId:'u',planId:'personal',status:'active',periodStart:new Date(now-10000).toISOString(),periodEnd:new Date(now+100000).toISOString()}],subscriptionPeriods:[{id:'p',subscriptionId:'s',userId:'u',planId:'personal',start:new Date(now-10000).toISOString(),end:new Date(now+100000).toISOString(),quotaTokens:50000}],subscriptionUsage:[]};}
test('OCR route requires funded subscription and releases reservations on provider failure',async()=>{
 const events=[];let response;
 const ctx={store:store(),userFor:()=>({id:'u'}),body:async()=>({photos:[image()]}),json:(res,status,data)=>{response={status,data};},reserve:async(u,tokens)=>{events.push(['reserve',tokens]);return{id:'r'};},release:async()=>events.push(['release']),settle:async()=>events.push(['settle']),account:()=>({}),apiKey:'test',fetchImpl:async()=>({ok:false})};
 assert.equal(await photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},ctx),true);
 assert.equal(response.status,502);assert.deepEqual(events,[['reserve',1536],['release']]);
 ctx.store.subscriptionPeriods=[];events.length=0;
 await photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},ctx);assert.equal(response.status,403);assert.equal(events.length,0);
});
test('successful OCR settles below its estimate and reports account state',async()=>{
 const events=[];let response;
 await photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},{store:store(),userFor:()=>({id:'u'}),body:async()=>({photos:[image()]}),json:(res,status,data)=>{response={status,data};},reserve:async()=>({id:'r'}),release:async()=>events.push('release'),settle:async(u,r,tokens)=>events.push(tokens),account:()=>({subscription:{active:true}}),apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Hello world.'}]}]})})});
 assert.equal(response.status,200);assert.equal(events[0],response.data.tokens);assert.equal(events.length,1);assert.equal(response.data.subscription.active,true);
});
test('stable page request ID caches completion without another provider call or charge',async()=>{
 const saved=store();let calls=0,charges=0,response;const requestId='request-0123456789';
 const ctx={store:saved,userFor:()=>({id:'u'}),body:async()=>({photos:[image()],requestId}),json:(res,status,data)=>{response={status,data};},reserve:async()=>({id:'r'}),release:async()=>{},settle:async()=>{charges++;},account:()=>({}),apiKey:'test',fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Saved text.'}]}]})};}};
 await photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},ctx);assert.equal(response.status,200);
 await photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},ctx);assert.equal(response.status,200);assert.equal(response.data.text,'Saved text.');assert.equal(calls,1);assert.equal(charges,1);
 ctx.body=async()=>({photos:[image(1920,1080)],requestId});
 await photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},ctx);assert.equal(response.status,400);assert.equal(saved.ocrJobs[0].status,'completed');
});
test('concurrent duplicate page is rejected while the original request remains reserved once',async()=>{
 let unblock;const hold=new Promise(resolve=>{unblock=resolve;});let calls=0,charges=0;const responses=[];
 const ctx={store:store(),userFor:()=>({id:'u'}),body:async()=>({photos:[image()],requestId:'pending-request-0123456789'}),json:(res,status,data)=>responses.push({status,data}),reserve:async()=>({id:'r'}),release:async()=>{},settle:async()=>{charges++;},account:()=>({}),apiKey:'test',fetchImpl:async()=>{calls++;await hold;return{ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Text.'}]}]})};}};
 const first=photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},ctx);
 await new Promise(resolve=>setImmediate(resolve));
 await photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},ctx);assert.equal(responses[0].status,409);
 unblock();await first;assert.equal(calls,1);assert.equal(charges,1);assert.equal(responses[1].status,200);
});

test('dense OCR text is cached when extra allowance is unavailable and retry never reruns OCR', async () => {
 const saved=store(), events=[];let calls=0,response,canSettle=false;
 const ctx={store:saved,persist:async()=>{},userFor:()=>({id:'u'}),body:async()=>({photos:[image()],requestId:'dense-page-0123456789'}),json:(res,status,data)=>{response={status,data};},reserve:async(user,tokens)=>{events.push(['reserve',tokens]);return{id:'hold'};},release:async()=>events.push(['release']),settle:async()=>{if(!canSettle){const error=new Error('More allowance needed');error.status=402;throw error;}events.push(['settle']);},account:()=>({}),apiKey:'test',fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Dense page text. '.repeat(300)}]}]})};}};
 await photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},ctx);
 assert.equal(response.status,402);assert.equal(saved.ocrJobs[0].status,'awaiting_allowance');
 const actual=saved.ocrJobs[0].result.tokens;assert.ok(actual>1536&&actual<=4096);
 assert.deepEqual(events,[['reserve',1536],['release']]);
 canSettle=true;await photoOcrApi({method:'POST'},{},{pathname:'/api/ocr'},ctx);
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(saved.ocrJobs[0].status,'completed');
 assert.deepEqual(events,[['reserve',1536],['release'],['reserve',actual],['settle']]);
});
