import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const directory=process.env.LAUNCH_WORK_DIR||'/tmp/shiroko-launch';
const ffmpeg=process.env.FFMPEG||'ffmpeg';
const {video,marks:m}=JSON.parse(await readFile(`${directory}/recording.json`,'utf8'));
// Keep the actual loading animation; shorten the wait, never fabricate results.
const shots=[
 {name:'original',start:m.editor,end:m.submit,duration:3},
 {name:'loading',start:m.loading+.2,end:Math.min(m.loading+1.2,m.completed),duration:1},
 {name:'reveal',start:m.reveal,end:m.compare,duration:3},
 {name:'compare',start:m.compare,end:m.scroll,duration:5},
 {name:'edit',start:m.edit,end:m.done,duration:4},
 {name:'together',start:m.done,end:m.end,duration:2}
];
const split=`[0:v]split=${shots.length}${shots.map((_,i)=>`[s${i}]`).join('')}`;
const edits=shots.map((shot,i)=>`[s${i}]trim=start=${shot.start}:end=${shot.end},setpts=(PTS-STARTPTS)*${shot.duration/(shot.end-shot.start)},fps=30,trim=duration=${shot.duration},setpts=PTS-STARTPTS[v${i}]`);
const concat=`${shots.map((_,i)=>`[v${i}]`).join('')}concat=n=${shots.length}:v=1:a=0,format=yuv420p[v]`;
await writeFile(`${directory}/edit-plan.json`,JSON.stringify({duration:23,drop:6,endCard:20,shots},null,2));
const args=['-hide_banner','-loglevel','error','-y','-i',video,'-filter_complex_threads','1','-filter_complex',[split,...edits,concat].join(';'),'-map','[v]','-an','-c:v','libx264','-preset','fast','-crf','19','-threads','2','-movflags','+faststart',`${directory}/montage.mp4`];
await new Promise((resolve,reject)=>{const process=spawn(ffmpeg,args,{stdio:'inherit'});process.on('exit',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}`)));});
console.log('Edited 18 seconds of filmed interface footage; reveal mapped to final 6.000s music drop.');
