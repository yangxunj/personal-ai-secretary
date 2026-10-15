import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../src/lib/realtime/playback.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const {PcmPlaybackClock}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('bursty packet arrival stays contiguous where the previous 25ms buffer would create audible gaps',()=>{
  const clock=new PcmPlaybackClock(),arrivals=[0,.16,.20,.40,.44,.64,.68,.84,.88,1.00];
  const starts=arrivals.map(now=>clock.schedule(now,.1,'reply'));
  close(starts[0],.2);
  for(let i=1;i<starts.length;i++)close(starts[i],starts[i-1]+.1);
  assert.equal(clock.stats.underruns,0);
  let oldCursor=0,oldGaps=0;
  for(const now of arrivals){const start=Math.max(now+.025,oldCursor);if(oldCursor&&start>oldCursor+.001)oldGaps++;oldCursor=start+.1}
  assert.ok(oldGaps>=3);
});

test('stable and faster-than-playback streams add no per-packet delay or duration changes',()=>{
  for(const cadence of [.02,.1]){
    const clock=new PcmPlaybackClock();let end=0;
    for(let i=0;i<100;i++){const start=clock.schedule(i*cadence,.1,'reply');if(i)close(start,end);end=start+.1}
    close(end,10.2);assert.equal(clock.stats.underruns,0);
  }
});

test('a real underrun rebuilds a bounded buffer and later packets join it without overlap',()=>{
  const clock=new PcmPlaybackClock();clock.schedule(0,.1,'reply');
  const recovered=clock.schedule(.6,.1,'reply');
  assert.ok(recovered>=.8&&recovered<=.9);assert.equal(clock.stats.underruns,1);
  close(clock.schedule(.65,.1,'reply'),recovered+.1);
  assert.equal(clock.stats.maxArrivalGapMs,600);assert.ok(clock.stats.bufferMs<=300);
});

test('an interrupted response cannot leave its queued playback time in the next response',()=>{
  const clock=new PcmPlaybackClock();clock.schedule(0,10,'old');clock.reset();
  close(clock.schedule(.05,.1,'new'),.25);assert.equal(clock.stats.underruns,0);assert.equal(clock.stats.chunks,1);
});

test('a pause between replies is not mistaken for a network underrun',()=>{
  const clock=new PcmPlaybackClock();clock.schedule(0,.1,'first');clock.schedule(30,.1,'second');
  assert.deepEqual(clock.stats,{chunks:1,underruns:0,maxArrivalGapMs:0,maxUpstreamGapMs:0,bufferMs:200});
});

test('timing diagnostics distinguish upstream arrival gaps from browser arrival gaps without message contents',()=>{
  const clock=new PcmPlaybackClock();clock.schedule(0,.1,'reply');clock.schedule(.6,.1,'reply',100);
  assert.equal(clock.stats.maxArrivalGapMs,600);assert.equal(clock.stats.maxUpstreamGapMs,100);
  assert.ok(!JSON.stringify(clock.stats).includes('reply'));
});

test('invalid times and unbounded queued output remain rejected',()=>{
  const clock=new PcmPlaybackClock();
  for(const [now,duration]of [[NaN,.1],[-1,.1],[0,NaN],[0,0],[0,-1]])assert.throws(()=>clock.schedule(now,duration,'invalid'));
  clock.schedule(0,31,'large');assert.throws(()=>clock.schedule(0,.1,'large'));
});
