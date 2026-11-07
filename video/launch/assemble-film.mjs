// Frame-exact final edit: original frames 0–599, then the 180-frame logo morph.
// One continuous 26-second score avoids an audible splice at the picture cut.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {copyFile,readFile} from 'node:fs/promises';
const ffmpeg=process.env.FFMPEG||'/tmp/shiroko-demo/node_modules/ffmpeg-static/ffmpeg';
const work=process.env.LAUNCH_OUTRO_DIR||'/tmp/shiroko-logo-outro';
for(const aspect of ['16x9','1x1','9x16']){
 const original=`${work}/intro-original-${aspect}.mp4`;
 const outro=`${work}/silent-${aspect}.mp4`;
 await readFile(original);await readFile(outro);await readFile(`${work}/score-26.wav`);
 const temporary=`${work}/final-26-${aspect}.mp4`;
 const output=aspect==='16x9'?'public/demo/side-by-side-launch.mp4':`video/launch/exports/launch-${aspect}.mp4`;
 const command=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',original,'-i',outro,'-i',`${work}/score-26.wav`,'-filter_complex','[0:v]trim=end_frame=600,setpts=PTS-STARTPTS,setsar=1[v0];[1:v]trim=end_frame=180,setpts=PTS-STARTPTS,setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-af','loudnorm=I=-20:TP=-2:LRA=8','-c:v','libx264','-preset','fast','-crf','20','-threads','2','-c:a','aac','-b:a','128k','-ar','48000','-r','30','-t','26','-movflags','+faststart',temporary],{stdio:['ignore','inherit','inherit']});
 const [code]=await once(command,'exit');if(code)throw new Error(`Final encode failed: ${aspect}`);
 await copyFile(temporary,output);console.log(`Exported ${aspect}: 26.00s, single logo ending, continuous score.`);
}
