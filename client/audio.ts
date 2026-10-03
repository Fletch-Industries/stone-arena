import type { GameEvent, Player, Body } from '../shared/game.js';
import { BIOMES, biomeAt } from '../shared/biomes.js';
/** Original synthesized soundscape. One ambience loop and a capped transient voice pool. */
export class ArenaAudio {
  context?:AudioContext; master?:GainNode; ambient?:GainNode; windFilter?:BiquadFilterNode; noiseBuffer?:AudioBuffer;
  voices=0; stepDistance=0; last?:{x:number;y:number;z:number;realm?:string;grounded:boolean}; noteAt=0; natureAt=0; note=0; charge=false;
  enable(){ if(!this.context){const c=this.context=new AudioContext();this.master=c.createGain();const limiter=c.createDynamicsCompressor();limiter.threshold.value=-16;limiter.ratio.value=5;this.master.connect(limiter);limiter.connect(c.destination);this.noiseBuffer=c.createBuffer(1,c.sampleRate*2,c.sampleRate);const d=this.noiseBuffer.getChannelData(0);for(let n=0;n<d.length;n++)d[n]=Math.random()*2-1;
    const wind=c.createBufferSource();wind.buffer=this.noiseBuffer;wind.loop=true;this.windFilter=c.createBiquadFilter();this.windFilter.type='lowpass';this.windFilter.frequency.value=650;this.ambient=c.createGain();this.ambient.gain.value=0;wind.connect(this.windFilter);this.windFilter.connect(this.ambient);this.ambient.connect(this.master);wind.start();} void this.context.resume(); }
  tone(hz:number,seconds=.15,gain=.1,delay=0,type:OscillatorType='sine',end=hz){ const c=this.context;if(!c||!this.master||this.voices>=32)return;this.voices++;const t=c.currentTime+delay,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(hz,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+seconds);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+seconds);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+seconds+.02);o.onended=()=>{o.disconnect();g.disconnect();this.voices--;}; }
  noise(seconds:number,cutoff:number,gain:number){const c=this.context;if(!c||!this.master||!this.noiseBuffer||this.voices>=32)return;this.voices++;const b=c.createBufferSource(),filter=c.createBiquadFilter(),g=c.createGain(),t=c.currentTime;b.buffer=this.noiseBuffer;filter.type='lowpass';filter.frequency.value=cutoff;g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+seconds);b.connect(filter);filter.connect(g);g.connect(this.master);b.start(t,Math.random()*.7);b.stop(t+seconds+.02);b.onended=()=>{b.disconnect();filter.disconnect();g.disconnect();this.voices--;}; }
  chime(gain=.1){[293.66,369.99,440,587.33].forEach((f,i)=>this.tone(f,.65,gain,i*.11));}
  event(e:GameEvent,local:boolean,gain=1){if(!this.context)return;gain*=local?1:.35;
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
  update(dt:number,p:Player|undefined,body:Body|undefined,active:boolean,volume:number,music:boolean,seed=0){const c=this.context;if(!c||!this.master)return;const audible=active&&!document.hidden, habitat=p?.realm==='wilds'&&body?BIOMES[biomeAt(body.x,body.z,seed)]:undefined;this.master.gain.setTargetAtTime(Math.max(0,Math.min(1,volume)),c.currentTime,.08);this.ambient!.gain.setTargetAtTime(audible?(habitat ? .05 : .022):0,c.currentTime,.3);this.windFilter!.frequency.setTargetAtTime(habitat?550*habitat.tune:230,c.currentTime,.4);
    if(audible&&music&&c.currentTime>this.noteAt){const notes=[146.83,220,293.66,220,164.81,246.94,329.63,246.94];this.tone(notes[this.note++%notes.length]*(habitat?.tune??1),2.8,.018);this.noteAt=c.currentTime+2.5;}
    if(audible&&habitat&&c.currentTime>this.natureAt){const frequency=620*habitat.tune;this.tone(frequency,.18,.012,0,'sine',frequency*1.7);this.tone(frequency*1.4,.22,.009,.25,'sine',frequency*.8);this.natureAt=c.currentTime+8;}
    if(audible&&body){if(this.last&&this.last.realm===body.realm){const d=Math.hypot(body.x-this.last.x,body.z-this.last.z);if(d<2)this.stepDistance+=d;if(!this.last.grounded&&body.grounded){this.noise(.15,p?.realm==='wilds'?1000:550,.1);this.tone(65,.12,.05);}if(body.grounded&&this.stepDistance>1.9){this.stepDistance=0;this.noise(.09,p?.realm==='wilds'?1400:750,p?.sprinting ? .065 : .04);this.tone(p?.realm==='wilds'?80:115,.08,.025,0,'triangle',50);}}this.last={x:body.x,y:body.y,z:body.z,realm:body.realm,grounded:body.grounded};}else this.last=undefined;
    if(audible&&p&&p.charge>.08&&(p.weapon==='bow'||p.weapon==='crossbow')&&!this.charge)this.tone(160,.28,.035,0,'triangle',320);this.charge=!!p&&p.charge>.08;
  }
}
