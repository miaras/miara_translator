import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=process.env.LAUNCH_WORK_DIR||'/tmp/shiroko-launch';
const stage=await readFile(new URL('./stage.html',import.meta.url));
const footage=await readFile(`${directory}/montage.mp4`);
const server=http.createServer((req,res)=>{
 if(req.url.split('?')[0]==='/montage.mp4'){
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):footage.length-1;res.writeHead(206,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${footage.length}`,'Accept-Ranges':'bytes'});res.end(footage.subarray(start,end+1));}
  else {res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':footage.length,'Accept-Ranges':'bytes'});res.end(footage);}
 }else {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(stage);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 for(const aspect of (process.env.LAUNCH_ASPECTS||'16x9,1x1,9x16').split(',')){
  const sizes={'16x9':[1920,1080],'1x1':[1080,1080],'9x16':[1080,1920]};
  const [width,height]=sizes[aspect];
  const viewport={width:Math.round(width*2/3),height:Math.round(height*2/3)};
  const context=await browser.newContext({viewport,recordVideo:{dir:`${directory}/composed`,size:viewport}});
  const page=await context.newPage();
  page.on('console',message=>console.log(message.text()));
  page.on('crash',()=>console.error('Render page crashed.'));
  page.on('pageerror',error=>console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}/?aspect=${aspect}`,{waitUntil:'networkidle'});
  await page.evaluate(()=>window.ready);
  console.log(`Recording ${aspect} composition from moving browser footage…`);
  await page.evaluate(()=>window.record());
  const recording=page.video();
  await context.close();
  await recording.saveAs(`${directory}/launch-${aspect}.webm`);
  console.log(`Rendered ${aspect} recorded composition.`);
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
