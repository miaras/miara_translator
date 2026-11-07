import http from 'node:http';
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/shiroko-demo/node_modules/playwright/index.mjs');
const ffmpeg=process.env.FFMPEG||'/tmp/shiroko-demo/node_modules/ffmpeg-static/ffmpeg';
const work=process.env.LAUNCH_OUTRO_DIR||'/tmp/shiroko-logo-outro';await mkdir(work,{recursive:true});
const html=await readFile(new URL('./logo-outro.html',import.meta.url));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const aspects={'16x9':[1920,1080],'1x1':[1080,1080],'9x16':[1080,1920]};
async function run(args){const p=spawn(ffmpeg,args,{stdio:['ignore','inherit','inherit']});const [code]=await once(p,'exit');if(code)throw new Error(`ffmpeg: ${code}`)}
try{
 for(const [aspect,[width,height]]of Object.entries(aspects)){
  let page;
  async function openPage(){const p=await browser.newPage({viewport:{width:Math.round(width*2/3),height:Math.round(height*2/3)},deviceScaleFactor:1});await p.goto(`http://127.0.0.1:${server.address().port}/?size=${width}x${height}`);return p;}
  page=await openPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/?size=${width}x${height}`);
  for(const [name,t] of [['A',.3],['morph',1.25],['mi',2.15],['brand',5]]){
   await page.evaluate(t=>window.drawFrame(t),t);await page.screenshot({path:`${work}/${aspect}-${name}.png`});
  }
  if(process.argv.includes('--stills')){await page.close();continue;}
  const silent=`${work}/silent-${aspect}.mp4`;
  const encoder=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','pipe:0','-an','-vf',`scale=${width}:${height}:flags=lanczos`,'-c:v','libx264','-preset','fast','-crf','18','-threads','2','-pix_fmt','yuv420p',silent],{stdio:['pipe','inherit','inherit']});
  const finished=once(encoder,'exit');
  for(let frame=0;frame<180;frame++){
   if(frame>0&&frame%60===0){await page.close();page=await openPage();}
   await page.evaluate(t=>window.drawFrame(t),frame/30);
   const png=await page.screenshot({type:'jpeg',quality:94});if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
   if(frame%30===0)console.log(`${aspect}: frame ${frame}/180`);
  }
  encoder.stdin.end();const [code]=await finished;if(code)throw new Error('Frame encode failed');await page.close();
  const outro=`${work}/logo-outro-${aspect}.mp4`;
  await run(['-hide_banner','-loglevel','error','-y','-i',silent,'-i',`${work}/logo-resolve.wav`,'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','128k','-ar','48000','-t','6','-movflags','+faststart',outro]);
  const output=aspect==='16x9'?'public/demo/side-by-side-launch.mp4':`video/launch/exports/launch-${aspect}.mp4`;
  // Preserve the original intro so repeated renders never append the ending twice.
  const original=`${work}/intro-original-${aspect}.mp4`;try{await readFile(original)}catch{await copyFile(output,original)}
  if(aspect==='16x9')await copyFile(outro,'public/demo/shiroko-logo-morph.mp4');else await copyFile(outro,`video/launch/exports/logo-morph-${aspect}.mp4`);
  console.log(`Exported ${aspect}: standalone 6s morph; final assembly follows.`);
 }
}finally{await browser.close();await new Promise(r=>server.close(r))}

if(!process.argv.includes('--stills'))await import('./assemble-film.mjs');
