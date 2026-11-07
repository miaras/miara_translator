import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const directory=process.env.LAUNCH_WORK_DIR||'/tmp/shiroko-launch';
const ffmpeg=process.env.FFMPEG||'ffmpeg';
const score=process.env.LAUNCH_SCORE||'/tmp/shiroko-demo/launch-score.wav';
const exports=new URL('./exports/',import.meta.url);
await mkdir(exports,{recursive:true});
async function run(args){await new Promise((resolve,reject)=>{const command=spawn(ffmpeg,args,{stdio:'inherit'});command.on('exit',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}`)));});}
for(const aspect of (process.env.LAUNCH_ASPECTS||'16x9,1x1,9x16').split(',')){
 const input=`${directory}/launch-${aspect}.webm`;
 const sync=`${directory}/sync-${aspect}.txt`;
 await run(['-hide_banner','-loglevel','error','-y','-i',input,'-t','6','-vf',`crop=4:4:0:0,signalstats,metadata=print:file=${sync}`,'-an','-f','null','-']);
 const metadata=await readFile(sync,'utf8');
 const whites=metadata.split(/(?=frame:)/).filter(block=>Number(/lavfi.signalstats.YAVG=([\d.]+)/.exec(block)?.[1])>180).map(block=>Number(/pts_time:([\d.]+)/.exec(block)[1]));
 // Chromium's initial blank page can also be white. The final white run is the film sync marker.
 const groups=[];
 for(const timestamp of whites){const last=groups.at(-1);if(!last||timestamp-last.at(-1)>.1)groups.push([timestamp]);else last.push(timestamp);}
 if(!groups.length)throw new Error(`Missing sync marker for ${aspect}.`);
 const offset=groups.at(-1)[0];
 const sizes={'16x9':'1920:1080','1x1':'1080:1080','9x16':'1080:1920'};
 const output=aspect==='16x9'?'public/demo/side-by-side-launch.mp4':new URL(`launch-${aspect}.mp4`,exports).pathname;
 console.log(`Encoding ${aspect}; first film frame at ${offset.toFixed(3)}s.`);
 await run(['-hide_banner','-loglevel','error','-y','-ss',String(offset),'-i',input,'-i',score,'-map','0:v:0','-map','1:a:0','-vf',`drawbox=x=0:y=0:w=4:h=4:color=0x10212b:t=fill,scale=${sizes[aspect]}:flags=lanczos,fps=30,format=yuv420p`,'-af','loudnorm=I=-20:TP=-2:LRA=8','-c:v','libx264','-preset','fast','-crf','20','-threads','2','-c:a','aac','-b:a','128k','-ar','48000','-t','23','-movflags','+faststart',output]);
 console.log(`Exported ${output}.`);
}
