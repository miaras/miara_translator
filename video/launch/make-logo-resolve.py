"""Six-second original tail locked before picture. C minor; 120 BPM.
Morph starts at 0.55s, resolves to mi by 2s; brand resolves on 3.5s beat.
"""
import array, math, wave
from pathlib import Path
rate=48000
samples=array.array('f',[0])* (rate*6)
def tone(start,length,note,volume,decay):
    frequency=440*2**((note-69)/12)
    for j in range(min(int(length*rate),len(samples)-int(start*rate))):
        t=j/rate
        envelope=min(1,t/.04)*min(1,(length-t)/.4)*math.exp(-decay*t)
        samples[int(start*rate)+j]+=volume*envelope*(math.sin(2*math.pi*frequency*t)+.15*math.sin(4*math.pi*frequency*t))
for note in [48,55,63,67]:tone(0,6,note,.045,.25)
for start,note in [(.5,72),(1,75),(1.5,79),(2,82)]:tone(start,.8,note,.022,3)
for note in [60,67,75]:tone(3.5,2.5,note,.055,1.8)
raw=array.array('h')
for i,v in enumerate(samples):
    t=i/rate;fade=min(1,t/.15,(6-t)/.65)
    raw.append(round(max(-1,min(1,v*fade))*32767))
p=Path('/tmp/shiroko-logo-outro');p.mkdir(exist_ok=True)
with wave.open(str(p/'logo-resolve.wav'),'wb') as w:
    w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(raw.tobytes())
print('Locked six-second musical resolve; brand beat at 3.5 seconds.')
