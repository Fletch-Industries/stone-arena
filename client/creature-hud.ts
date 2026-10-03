import { CREATURES, WARDEN, creatureTouch, creatureView } from '../shared/creatures.js';
import { SUPPLIES } from '../shared/forage.js';
import type { Player, Snapshot } from '../shared/game.js';

export function creatureHUD(p:Player|undefined,s:Snapshot,mobile:boolean,disconnected=false) {
  if(!p?.alive||p.realm!=='wilds'||s.phase!=='active')return {prompt:'',status:''};
  const creatures=(s.creatures??[]).map(creatureView),target=creatureTouch(p,creatures,s.world),key=mobile?'':'R · ';
  const rest=Math.max(0,Math.ceil(((p.friendReadyAt??0)-s.tick)/60)),available=!disconnected&&p.connected&&!p.block&&p.charge===0&&rest===0&&p.hurtTime===0;
  let prompt='';
  if(target?.kind===4&&target.state==='dormant')prompt=`<div class="gather-hint creature-hint interactive"><b>Shade Warden</b><button class="btn gold" data-action="creature" ${available?'':'disabled'}>${rest?`Challenge ready in ${rest}s`:`${key}Challenge Warden`}</button><small>Optional · Dodge violet pulses or face it with your shield</small></div>`;
  else if(target&&target.kind!==4){
    const species=CREATURES[target.kind],own=target.owner===p.id,other=!!target.owner&&!own,ready=available&&!other&&(own||(s.world.supplies?.[species.food]??0)>0);
    prompt=`<div class="gather-hint creature-hint interactive"><b>${species.name}${own?' · Your companion':''}</b><button class="btn gold" data-action="creature" ${ready?'':'disabled'}>${other?'Exploring with a friend':own?rest?`Scout ready in ${rest}s`:`${key}Scout for supplies`:`${key}Offer 1 ${SUPPLIES[species.food].name}`}</button><small>${own?'Follows you · A heart marks your friend':'One companion each · Atlas → Field guide'}</small></div>`;
  }
  const guardian=creatures.filter(c=>c.kind===4&&c.hp>0&&c.state!=='dormant'&&Math.hypot(c.x-p.x,c.z-p.z)<20).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
  const status=guardian?`<div class="warden-hud ${guardian.state==='windup'?'pulse-coming':''}"><b>SHADE WARDEN</b><div role="progressbar" aria-label="Shade Warden health" aria-valuemin="0" aria-valuemax="${WARDEN.health}" aria-valuenow="${Math.round(guardian.hp)}"><i style="width:${guardian.hp/WARDEN.health*100}%"></i></div><small>${guardian.state==='windup'?'Pulse incoming · Leave the violet circle or face the Warden and block':guardian.state==='recover'?'Warden recovering · Your turn to strike':'Time your hits · Dodge or shield its pulse'}</small></div>`:'';
  return {prompt,status};
}
