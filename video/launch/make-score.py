"""Original 23-second synth score. 120 BPM; reveal/drop at 6s, end card at 20s."""
import array, math, random, sys, wave
from pathlib import Path
rate, duration = 48000, 23
samples = array.array('f', [0]) * (rate * duration)
rng = random.Random(19)
def tone(start, length, frequency, level, decay=0, bright=False):
    begin = round(start * rate)
    for j in range(min(round(length * rate), len(samples)-begin)):
        t = j / rate
        attack = min(1, t / .018)
        release = min(1, (length-t) / .18)
        env = attack * release * (math.exp(-decay*t) if decay else 1)
        value = math.sin(2*math.pi*frequency*t)
        if bright: value += .3*math.sin(4*math.pi*frequency*t) + .12*math.sin(6*math.pi*frequency*t)
        samples[begin+j] += level*env*value

def midi(note): return 440 * 2 ** ((note-69)/12)
for start, length, chord in [(0,6,[48,55,63]),(6,4,[48,55,63,70]),(10,4,[44,51,60,67]),(14,4,[46,53,62,65]),(18,5,[48,55,63,67])]:
    for note in chord: tone(start,length,midi(note),.022)
for beat in range(12,40):
    start=beat*.5
    tone(start,.42,midi([36,36,32,34][min(3,(beat-12)//8)]),.12,decay=6)
    # Short kick transient, tuned below the musical bass.
    for j in range(round(.16*rate)):
        t=j/rate
        samples[round(start*rate)+j] += .16*math.sin(2*math.pi*(45*t+4*(1-math.exp(-28*t))))*math.exp(-25*t)
    tone(start+.25,.22,midi([72,79,75,82][beat%4]),.036,decay=15,bright=True)
for beat in range(4,12): tone(beat*.5,.25,midi(72+([0,3,7,10][beat%4])),.018,decay=14,bright=True)
# Air builds into the reveal, then resolves on the drop.
last=0
for j in range(round(3.5*rate),round(6*rate)):
    t=j/rate
    noise=rng.uniform(-1,1)
    high=noise-last
    last=noise
    samples[j] += high * .012 * ((t-3.5)/2.5)**2
for start in [6,20]:
    for note in [60,67,75]: tone(start,2.3,midi(note),.055,decay=2.5,bright=True)
peak=max(abs(v) for v in samples)
output=array.array('h')
for j,v in enumerate(samples):
    t=j/rate
    fade=min(1,t/.25,(23-t)/.8)
    output.append(round(v/max(1,peak/.72)*fade*32767))
path=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/shiroko-demo/launch-score.wav')
with wave.open(str(path),'wb') as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(output.tobytes())
print(f'Locked original score: {duration}s, 120 BPM; drop 6.000s; end card 20.000s.')
