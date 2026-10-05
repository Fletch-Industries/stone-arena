import { nativeSolid } from '../shared/terrain-collision.js';
import type { WorldState } from '../shared/world.js';
import type { GameEvent, Player, Body } from '../shared/game.js';
import { BIOMES, biomeAt } from '../shared/biomes.js';
import type { CreatureWire } from '../shared/creatures.js';
import { FOOTSTEPS, footstepSurface } from './footsteps.js';
import { gatheringFeedback } from './gathering.js';
import { weavingFeedback } from './weaving-feedback.js';
/** Original synthesized soundscape. One ambience loop and a capped transient voice pool. */
export class ArenaAudio {
  context?:AudioContext; master?:GainNode; ambient?:GainNode; windFilter?:BiquadFilterNode; noiseBuffer?:AudioBuffer;
  voices=0; stepDistance=0; last?:{x:number;y:number;z:number;realm?:string;grounded:boolean;flying?:boolean}; noteAt=0; natureAt=0; creatureAt=0; note=0; charge=false; stoneAt=0;
  enable(){ if(!this.context){const c=this.context=new AudioContext();this.master=c.createGain();const limiter=c.createDynamicsCompressor();limiter.threshold.value=-16;limiter.ratio.value=5;this.master.connect(limiter);limiter.connect(c.destination);this.noiseBuffer=c.createBuffer(1,c.sampleRate*2,c.sampleRate);const d=this.noiseBuffer.getChannelData(0);for(let n=0;n<d.length;n++)d[n]=Math.random()*2-1;
    const wind=c.createBufferSource();wind.buffer=this.noiseBuffer;wind.loop=true;this.windFilter=c.createBiquadFilter();this.windFilter.type='lowpass';this.windFilter.frequency.value=650;this.ambient=c.createGain();this.ambient.gain.value=0;wind.connect(this.windFilter);this.windFilter.connect(this.ambient);this.ambient.connect(this.master);wind.start();} void this.context.resume(); }
  tone(hz:number,seconds=.15,gain=.1,delay=0,type:OscillatorType='sine',end=hz){ const c=this.context;if(!c||!this.master||this.voices>=32)return;this.voices++;const t=c.currentTime+delay,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(hz,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+seconds);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+seconds);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+seconds+.02);o.onended=()=>{o.disconnect();g.disconnect();this.voices--;}; }
  noise(seconds:number,cutoff:number,gain:number){const c=this.context;if(!c||!this.master||!this.noiseBuffer||this.voices>=32)return;this.voices++;const b=c.createBufferSource(),filter=c.createBiquadFilter(),g=c.createGain(),t=c.currentTime;b.buffer=this.noiseBuffer;filter.type='lowpass';filter.frequency.value=cutoff;g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+seconds);b.connect(filter);filter.connect(g);g.connect(this.master);b.start(t,Math.random()*.7);b.stop(t+seconds+.02);b.onended=()=>{b.disconnect();filter.disconnect();g.disconnect();this.voices--;}; }
  chime(gain=.1){[293.66,369.99,440,587.33].forEach((f,i)=>this.tone(f,.65,gain,i*.11));}
  footstep(body:Body,seed:number,cave:boolean,sprinting:boolean){
    const sound=FOOTSTEPS[footstepSurface(body,seed,cave)];
    this.noise(sound.noiseSeconds,sound.cutoff,sprinting ? .065 : .04);
    this.tone(sound.hz,sound.toneSeconds,.025,0,'triangle',sound.end);
  }
  event(e:GameEvent,local:boolean,gain=1){if(!this.context)return;gain*=local?1:.35;
    if(e.type==='creature_bond'){[392,587,784].forEach((f,n)=>this.tone(f,.3,.045*gain,n*.09,'sine',f*1.1));}
    if(e.type==='creature_scout'||e.type==='creature_blink'){this.tone(523,.18,.045*gain,0,'sine',1046);this.tone(784,.24,.035*gain,.14,'sine',587);}
    if(e.type==='creature_challenge'){this.tone(110,.7,.07*gain,0,'triangle',220);this.tone(165,.6,.05*gain,.2,'sine',82);}
    if(e.type==='creature_hit'){this.noise(.11,1700,.075*gain);this.tone(340,.18,.035*gain,0,'triangle',170);}
    if(e.type==='creature_pulse'){this.noise(.33,1000,.1*gain);this.tone(85,.35,.06*gain,0,'sine',45);}
    if(e.type==='creature_clear'){[262,392,523,784].forEach((f,n)=>this.tone(f,.65,.06*gain,n*.12));}
    if(e.type==='mine'){this.noise(.14,1800,.065*gain);this.tone(120,.17,.045*gain,0,'triangle',65);[440,660,880].forEach((f,n)=>this.tone(f,.23,.025*gain,n*.055));}
    if(e.type==='mend'){this.tone(330,.35,.045*gain,0,'sine',660);this.tone(990,.35,.03*gain,.08,'sine',440);this.noise(.15,850,.035*gain);}
    if(e.type==='gather'){
      const sound=gatheringFeedback(e.supplyKind);
      sound.tones.forEach(([hz,seconds,delay,type,end],n)=>this.tone(hz,seconds,(n===0?.04:.03)*gain,delay,type,end));
      this.noise(sound.noise[0],sound.noise[1],.025*gain);
    }
    if(e.type==='craft'){[330,440,660,880].forEach((f,n)=>this.tone(f,.4,.04*gain,n*.1));}
    if(e.type==='glide'){this.noise(.45,2100,.08*gain);this.tone(165,.45,.045*gain,0,'sine',660);}
    if(e.type==='hearth'&&local)this.tone(220,.5,.025,0,'sine',330);
    if(e.type==='windlift'){this.tone(220,.38,.065*gain,0,'sine',880);this.noise(.22,2800,.055*gain);}
    if(e.type==='weave'){const sound=weavingFeedback(e.weaveKind);this.tone(sound.hz,.17,.045*gain,0,'triangle',sound.end);this.tone(sound.chime,.2,.018*gain,.04);this.noise(.06,sound.cutoff,.035*gain);}
    if(e.type==='erase'){this.tone(660,.15,.035*gain,0,'sine',220);this.noise(.13,1500,.035*gain);}
    if(e.type==='swing')this.noise(.15,1800,.1*gain);
    if(e.type==='shot'){this.tone(180,.18,.13*gain,0,'triangle',65);this.noise(.07,2800,.06*gain);}
    if(e.type==='hit'){this.noise(e.blocked ? .2 : .11,e.blocked?4000:1200,.18*gain);if(e.blocked)[540,880,1460].forEach(f=>this.tone(f,.3,.05*gain));else this.tone(e.critical?170:90,.14,.1*gain,0,'triangle',45);}
    if(e.type==='door'){this.noise(.9,180,.28);this.tone(55,.8,.12,0,'triangle',35);}
    if(e.type==='dash'){this.noise(.32,3600,.13*gain);this.tone(320,.3,.07*gain,0,'sine',950);}
    if(e.type==='warp'&&local){this.tone(130,.65,.08,0,'sine',880);this.noise(.45,1600,.06);}
    if(e.type==='travel'||e.type==='relic'||e.type==='totem'||e.type==='level'||e.type==='flag_capture'||e.type==='result'||e.type==='waystone'){if(local||e.type==='result'||e.type==='flag_capture')this.chime(.08*gain);}
    if(e.type==='heal'&&local){this.tone(440,.3,.07);this.tone(660,.35,.06,.12);}
    if(e.type==='start'){[220,330,440].forEach((f,i)=>this.tone(f,.22,.09,i*.2,'triangle'));}
  }
  update(dt:number,p:Player|undefined,body:Body|undefined,active:boolean,volume:number,music:boolean,seed=0,creatures:CreatureWire[]=[],world?:WorldState){const c=this.context;if(!c||!this.master)return;const audible=active&&!document.hidden, habitat=p?.realm==='wilds'&&body?BIOMES[biomeAt(body.x,body.z,seed)]:undefined, sailing=(body?.glideTime??0)>0,cave=!!body&&body.realm==='wilds'&&!!world&&nativeSolid({x:body.x,y:body.y+3.1,z:body.z},world);this.master.gain.setTargetAtTime(Math.max(0,Math.min(1,volume)),c.currentTime,.08);this.ambient!.gain.setTargetAtTime(audible?(cave ? .025 : sailing ? .09 : habitat ? .05 : .022):0,c.currentTime,.3);this.windFilter!.frequency.setTargetAtTime(cave?180:sailing?1250:habitat?550*habitat.tune:230,c.currentTime,.4);
    if(audible&&music&&c.currentTime>this.noteAt){const notes=[146.83,220,293.66,220,164.81,246.94,329.63,246.94];this.tone(notes[this.note++%notes.length]*(cave ? .5 : habitat?.tune ?? 1),2.8,.018);this.noteAt=c.currentTime+2.5;}
    if(audible&&!cave&&habitat&&c.currentTime>this.natureAt){const frequency=620*habitat.tune;this.tone(frequency,.18,.012,0,'sine',frequency*1.7);this.tone(frequency*1.4,.22,.009,.25,'sine',frequency*.8);this.natureAt=c.currentTime+8;}
    if(audible&&body&&habitat&&c.currentTime>this.creatureAt){const friend=creatures.filter(w=>w[1]<4&&Math.hypot(w[2]-body.x,w[4]-body.z)<20).sort((a,b)=>Math.hypot(a[2]-body.x,a[4]-body.z)-Math.hypot(b[2]-body.x,b[4]-body.z))[0];if(friend){const f=[680,440,280,870][friend[1]],gain=.025*(1-Math.hypot(friend[2]-body.x,friend[4]-body.z)/24);this.tone(f,.16,gain,0,'sine',f*1.5);this.tone(f*1.2,.2,gain*.7,.2,'sine',f*.9);}this.creatureAt=c.currentTime+6;}
    if(audible&&body&&volume>0){
      if(this.last&&this.last.realm===body.realm){
        const d=Math.hypot(body.x-this.last.x,body.z-this.last.z);
        if(!this.last.grounded&&body.grounded){this.noise(.15,p?.realm==='wilds'?1000:550,.1);this.tone(65,.12,.05);}
        if(body.grounded&&this.last.grounded&&!body.flying&&!this.last.flying&&d<6){
          this.stepDistance+=d;
          if(this.stepDistance>=1.9){
            this.stepDistance%=1.9; // Retain the stride remainder; never replay a burst.
            this.footstep(body,seed,cave,p?.sprinting===true);
          }
        }else this.stepDistance=0;
      }else this.stepDistance=0;
      this.last={x:body.x,y:body.y,z:body.z,realm:body.realm,grounded:body.grounded,flying:body.flying};
    }else{this.last=undefined;this.stepDistance=0;}
    if(audible&&p?.sculpting&&(p.sculptProgress??0)>0&&c.currentTime>this.stoneAt){const f=(p.sculptMending?330:220)+(p.sculptProgress??0)*2;this.tone(f,.12,.024,0,'sine',f*1.07);this.tone(f*2,.1,.009,.03);this.stoneAt=c.currentTime+.16;}
    if(audible&&p&&p.charge>.08&&(p.weapon==='bow'||p.weapon==='crossbow')&&!this.charge)this.tone(160,.28,.035,0,'triangle',320);this.charge=!!p&&p.charge>.08;
  }
}
