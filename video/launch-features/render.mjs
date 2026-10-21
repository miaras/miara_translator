import http from 'node:http';
import {readFile, mkdir, access, rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';

const base = fileURLToPath(new URL('.', import.meta.url));
const output = path.resolve(process.env.LAUNCH_OUTPUT_DIR || path.join(base, 'exports'));
const scratch = path.resolve(process.env.LAUNCH_WORK_DIR || path.join(base, '.render'));
const sizes = {'16x9': [1920,1080], '1x1': [1080,1080], '9x16': [1080,1920]};
const aspects = (process.env.LAUNCH_ASPECTS || '16x9,1x1,9x16').split(',');
const stillsOnly = process.argv.includes('--stills');
const batchSize = 120;
for (const aspect of aspects) if (!sizes[aspect]) throw Error(`Unknown aspect: ${aspect}`);
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let ffmpeg = process.env.FFMPEG;
if (!ffmpeg) { try { ffmpeg = (await import('ffmpeg-static')).default; } catch { ffmpeg = 'ffmpeg'; } }
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio:'inherit'});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)));
  });
}
if (!stillsOnly) await run(process.env.PYTHON || 'python3', [path.join(base,'make-score.py'),path.join(base,'assets/score.wav')]);
await mkdir(output, {recursive:true});
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = path.resolve(base, '.' + (pathname === '/' ? '/stage.html' : pathname));
    if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.json':'application/json','.jpg':'image/jpeg','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve)});
let browser;
async function openPage(aspect) {
  browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const [width,height] = sizes[aspect];
  const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  await page.goto(`http://127.0.0.1:${server.address().port}/?aspect=${aspect}`);
  await page.evaluate(() => window.ready);
  return page;
}
async function closeBrowser() { if (browser) { await browser.close(); browser = undefined; } }
try {
  for (const aspect of aspects) {
    let page = await openPage(aspect);
    for (const [label,time] of [['hook',1],['reveal',6.7],['side',10],['book-52',14],['book-53',17],['book-54',20.5],['end',25]]) {
      await page.evaluate(t => window.draw(t),time);
      await page.screenshot({path:path.join(output,`${label}-${aspect}.jpg`),type:'jpeg',quality:92});
    }
    await closeBrowser();
    console.log(`Stills ready: ${aspect}`);
    if (stillsOnly) continue;
    const frames = path.join(scratch,aspect);
    await mkdir(frames,{recursive:true});
    // Recycle Chromium regularly; do not keep FFmpeg and the browser in memory together.
    // Completed JPEG frames are reused on rerun. Clear .render after changing content.
    for (let frame=0;frame<780;frame++) {
      if (frame % batchSize === 0) { await closeBrowser(); page = undefined; }
      const file = path.join(frames,`frame-${String(frame).padStart(5,'0')}.jpg`);
      let exists = false;
      if (!process.argv.includes('--fresh')) { try { await access(file); exists = true; } catch {} }
      if (!exists) {
        if (!page) page = await openPage(aspect);
        await page.evaluate(t => window.draw(t),frame/30);
        const temporary = file + '.tmp';
        await page.screenshot({path:temporary,type:'jpeg',quality:92});
        await rename(temporary,file);
      }
      if (frame % batchSize === 0) console.log(`${aspect}: ${frame}/780 frames`);
    }
    await closeBrowser();
    const target = path.join(output,`launch-features-${aspect}.mp4`);
    const temporary = target.replace(/\.mp4$/,'.partial.mp4');
    await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-framerate','30','-i',path.join(frames,'frame-%05d.jpg'),'-i',path.join(base,'assets/score.wav'),'-map','0:v','-map','1:a','-frames:v','780','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t','26','-movflags','+faststart',temporary]);
    await rename(temporary,target);
    console.log(`Encoded ${target}`);
  }
} finally { await closeBrowser(); await new Promise(resolve => server.close(resolve)); }
