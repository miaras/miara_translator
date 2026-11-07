import { readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const ffmpeg=process.env.FFMPEG||'ffmpeg';
const directory=process.env.LAUNCH_WORK_DIR||'/tmp/shiroko-launch';
const files=[['16x9','public/demo/side-by-side-launch.mp4','1920x1080'],['1x1','video/launch/exports/launch-1x1.mp4','1080x1080'],['9x16','video/launch/exports/launch-9x16.mp4','1080x1920']];
async function run(args){return new Promise((resolve,reject)=>{let stderr='';const command=spawn(ffmpeg,args);command.stderr.on('data',data=>stderr+=data);command.on('exit',code=>code===0?resolve(stderr):reject(new Error(stderr)));});}
const results=[];
for(const [aspect,file,dimensions] of files){
 const info=await run(['-hide_banner','-i',file,'-f','null','-']);
 assert.match(info,/Duration: 00:00:26\.00/);
 assert.ok(info.includes(dimensions));
 assert.match(info,/Video: h264/);assert.match(info,/30 fps/);assert.match(info,/Audio: aac/);
 assert.match(info,/frame=\s*780\b/);
 results.push({aspect,file,dimensions,durationSeconds:26,frames:780,video:'H.264',audio:'AAC',bytes:(await stat(file)).size});
 console.log(`Verified ${aspect}: 26.00s, ${dimensions}, 780 frames, H.264 + AAC.`);
}
await run(['-hide_banner','-loglevel','error','-y','-ss','6','-i',files[0][1],'-t','14','-vf','fps=3,scale=32:18','-an','-f','framemd5',`${directory}/motion.md5`]);
const hashes=(await readFile(`${directory}/motion.md5`,'utf8')).split('\n').filter(line=>line&&!line.startsWith('#')).map(line=>line.split(',').at(-1).trim());
assert.ok(new Set(hashes).size>=15,'Expected moving process footage throughout the side-by-side section.');
await writeFile(new URL('./exports/verification.json',import.meta.url),JSON.stringify({film:'Shiroko side-by-side launch',source:'Filmed Moby-Dick English-to-French translation',results,distinctMotionSamples:new Set(hashes).size},null,2)+'\n');
console.log(`Verified moving footage: ${new Set(hashes).size} distinct samples across the 14-second side-by-side section.`);

// Verify the standalone ending and that its morph produces changing frames.
const outroInfo=await run(['-hide_banner','-i','public/demo/shiroko-logo-morph.mp4','-f','null','-']);
assert.match(outroInfo,/Duration: 00:00:06\.00/);
assert.match(outroInfo,/frame=\s*180\b/);
await run(['-hide_banner','-loglevel','error','-y','-ss','20','-i',files[0][1],'-t','3.5','-vf','fps=6,scale=64:36','-an','-f','framemd5',`${directory}/logo-morph.md5`]);
const morphHashes=(await readFile(`${directory}/logo-morph.md5`,'utf8')).split('\n').filter(line=>line&&!line.startsWith('#')).map(line=>line.split(',').at(-1).trim());
assert.ok(new Set(morphHashes).size>=12,'Expected a moving A-to-mi logo morph in the appended ending.');
console.log('Verified standalone 6s morph and moving logo ending in the complete intro.');
