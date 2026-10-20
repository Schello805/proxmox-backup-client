'use strict';
const crypto=require('node:crypto');
const {lastDuration,createTimeline}=require('./timeline');
const {scheduleKey}=require('./planning');
const WEEK=7*86400, BUFFER=600;
function slots(schedule,seconds) { const [hour,minute]=schedule.time.split(':').map(Number), result=[]; for(const day of schedule.days){const start=(day-1)*86400+hour*3600+minute*60, end=start+seconds+BUFFER; if(end-start>=WEEK)return [[0,WEEK]]; for(const shift of [-WEEK,0,WEEK])result.push([start+shift,end+shift]);}return result; }
function overlap(a,b){return a.some(([start,end])=>b.some(([other,stop])=>start<stop&&other<end));}
function planSuggestions(config,state,now=new Date()) {
  const rows=config.sources.map(source=>({...source,schedule:config.schedules[source.id],duration:lastDuration(source,config,state)}));
  const revision=crypto.createHash('sha256').update(JSON.stringify([scheduleKey(now,config.timezone).day,config.timezone,rows])).digest('hex');
  const known=rows.filter(row=>row.schedule.days.length&&row.duration), unknown=rows.filter(row=>row.schedule.days.length&&!row.duration).map(row=>row.name), suggestions=[], unresolved=[];
  for(const row of known){
    const current=slots(row.schedule,row.duration.seconds), others=known.filter(other=>other.id!==row.id), conflicts=others.filter(other=>overlap(current,slots(other.schedule,other.duration.seconds)));
    if(!conflicts.length)continue;
    const [hour,minute]=row.schedule.time.split(':').map(Number), original=hour*60+minute;
    let proposed=null;
    for(let offset=5;offset<1440;offset+=5){const candidate=(original+offset)%1440,time=String(Math.floor(candidate/60)).padStart(2,'0')+':'+String(candidate%60).padStart(2,'0');const schedule={...row.schedule,time}, candidateSlots=slots(schedule,row.duration.seconds);
      if(others.some(other=>overlap(candidateSlots,slots(other.schedule,other.duration.seconds))))continue;
      // A daily run longer than the gap to its own next weekday cannot be made collision-free by moving the clock.
      const starts=row.schedule.days.map(day=>(day-1)*86400).sort((a,b)=>a-b);if(starts.some((start,index)=>((starts[(index+1)%starts.length]+(index===starts.length-1?WEEK:0))-start)<row.duration.seconds+BUFFER))break;
      const preview=createTimeline({...config,schedules:{...config.schedules,[row.id]:schedule}},state,now), proposedRow=preview.rows.find(item=>item.id===row.id);
      const expected=preview.days.filter(day=>schedule.days.includes(new Date(day.day+'T12:00:00Z').getUTCDay()||7)).length;
      if(proposedRow.events.filter(event=>event.start>=preview.start).length<expected || proposedRow.events.some(event=>event.overlap))continue;
      proposed={id:row.id,name:row.name,currentTime:row.schedule.time,time,days:row.schedule.days,durationSeconds:row.duration.seconds,bufferMinutes:10,conflicts:conflicts.map(other=>other.name)};break;
    }
    if(proposed)suggestions.push(proposed);else unresolved.push({id:row.id,name:row.name,message:'Kein freies Zeitfenster bei unveränderten Wochentagen. Häufigkeit oder Tage anpassen.'});
  }
  return {revision,suggestions,unknown,unresolved};
}
module.exports={planSuggestions};
