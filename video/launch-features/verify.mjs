import {readFile,stat,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('.',import.meta.url));
let ffmpeg=process.env.FFMPEG;
if(!ffmpeg){try{ffmpeg=(await import('ffmpeg-static')).default}catch{ffmpeg='ffmpeg'}}
const output=process.env.LAUNCH_OUTPUT_DIR||base+'exports';
const content=JSON.parse(await readFile(base+'content.json','utf8'));
const expected=['20260821_173718.jpg','20260821_173722.jpg','20260821_173724.jpg'];
if(JSON.stringify(content.books.map(b=>b.file))!==JSON.stringify(expected))throw Error('Unexpected photo order');
if(content.rows.map(r=>r[0]).join(' ')!==(await readFile(base+'passage.txt','utf8')).trim())throw Error('Source passage changed');
const report=[];
for(const [aspect,size] of [['16x9','1920x1080'],['1x1','1080x1080'],['9x16','1080x1920']]){
 const file=output+`/launch-features-${aspect}.mp4`;
 const result=spawnSync(ffmpeg,['-hide_banner','-i',file,'-map','0:v:0','-map','0:a:0','-f','null','-'],{encoding:'utf8',maxBuffer:4*1024*1024});
 if(result.status!==0)throw Error(result.stderr);
 const log=result.stderr;
 for(const text of ['Duration: 00:00:26.00',size,'30 fps','Video: h264','Audio: aac'])if(!log.includes(text))throw Error(`Missing ${text} in ${aspect}`);
 if(!/frame=\s*780/.test(log))throw Error('Expected 780 decoded frames');
 report.push({aspect,size,duration:26,fps:30,decodedFrames:780,audio:'AAC',video:'H.264',bytes:(await stat(file)).size,decode:'passed'});
 console.log(`PASS ${aspect}: ${size}, 26s, 780 frames, H.264/AAC; complete decode`);
}
await writeFile(output+'/verification.json',JSON.stringify({sourcePassage:'exact match',photoOrder:expected,formats:report},null,2)+'\n');
