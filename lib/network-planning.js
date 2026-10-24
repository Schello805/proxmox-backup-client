'use strict';
// Analyze declared windows only. This never moves a job or measures live traffic.
function analyze({jobs,events,networks=[],resources={},start,end}){
 const byId=new Map(jobs.map(job=>[job.id,job]));
 const allWindows=events.filter(event=>byId.has(event.jobId)&&event.end!==null&&event.end>event.start&&event.start<end&&event.end>start).map(event=>({...event,start:Math.max(start,event.start),end:Math.min(end,event.end)}));
 const limited=allWindows.length>2000,windows=allWindows.slice(0,2000).sort((a,b)=>a.start-b.start);
 const warnings=[],unknownDuration=jobs.filter(job=>job.schedule?.time&&job.seconds===null).map(job=>job.name);
 const label=key=>{const index=key.indexOf(':'),kind=key.slice(0,index),id=key.slice(index+1);return kind==='device'?resources.sources?.find(item=>item.id===id)?.name||id:kind==='target'?resources.targets?.find(item=>item.id===id)?.name||id:(kind==='pbs'?'PBS ':'NAS ')+id;};
 const seen=new Set();let sharedTruncated=false;
 for(let i=0;i<windows.length;i++){
  const a=windows[i],first=byId.get(a.jobId);
  for(let j=i+1;j<windows.length;j++){
   const b=windows[j];if(b.start>=a.end)break;if(a.jobId===b.jobId||a.start>=b.end||b.start>=a.end)continue;
   const second=byId.get(b.jobId),bothApp=first.engine!=='external'&&second.engine!=='external';
   const common=(first.resources||[]).filter(key=>second.resources?.includes(key));
   if(!common.length&&!bothApp)continue;
   const key=[a.jobId,b.jobId].sort().join('|');if(seen.has(key))continue;seen.add(key);
   if(warnings.length>=30){sharedTruncated=true;break;}
   warnings.push({kind:bothApp?'queue':'shared',jobs:[first.name,second.name],start:Math.max(a.start,b.start),end:Math.min(a.end,b.end),resource:common.length?label(common[0]):'App-Warteschlange',message:bothApp?'App-Aufträge sind zeitgleich geplant und laufen nacheinander. Die tatsächlichen Zeitfenster können sich verschieben.':'Sicherungen nutzen denselben Quell- oder Zielbereich im gleichen Zeitfenster. Mögliche Konkurrenz, kein Nachweis einer Überlastung.'});
  }
  if(sharedTruncated)break;
 }
 const summaries=[];
 for(const network of networks){
  const relevant=windows.filter(event=>byId.get(event.jobId).networks?.some(item=>item.id===network.id));
  const bounds=[...new Set(relevant.flatMap(event=>[event.start,event.end]))].sort((a,b)=>a-b);
  let peak=0,unknownRate=false,firstOverload=null;
  for(let i=0;i<bounds.length-1;i++){
   const from=bounds[i],to=bounds[i+1],active=relevant.filter(event=>event.start<to&&event.end>from);
   const activeRates=active.map(event=>({event,job:byId.get(event.jobId),rate:byId.get(event.jobId).networks.find(item=>item.id===network.id).rate}));
   unknownRate ||= activeRates.some(item=>item.rate===null||!Number.isFinite(item.rate));
   // PBS and Drive share the app queue. Sum external transfers, but take only
   // the largest app rate instead of claiming app jobs transfer concurrently.
   const external=activeRates.filter(item=>item.job.engine==='external').reduce((sum,item)=>sum+(item.rate||0),0);
   const app=Math.max(0,...activeRates.filter(item=>item.job.engine!=='external').map(item=>item.rate||0));
   const rate=external+app;peak=Math.max(peak,rate);
   if(network.capacity_mib&&rate>network.capacity_mib&&!firstOverload)firstOverload={start:from,end:to,jobs:[...new Set(activeRates.map(item=>item.job.name))],rate};
  }
  const missingDurations=jobs.filter(job=>job.networks?.some(item=>item.id===network.id)&&job.schedule?.time&&job.seconds===null).map(job=>job.name);
  const summary={id:network.id,name:network.name,capacityMiB:network.capacity_mib,peakMiB:peak,incomplete:limited||unknownRate||missingDurations.length>0,missingDurations,overload:firstOverload};summaries.push(summary);
  if(firstOverload)warnings.unshift({kind:'capacity',network:network.name,capacityMiB:network.capacity_mib,peakMiB:firstOverload.rate,start:firstOverload.start,end:firstOverload.end,jobs:firstOverload.jobs,message:'Erwartete Übertragungsraten überschreiten in diesem Zeitfenster die eingetragene Netzkapazität. Schätzung, keine Live-Messung.'});
 }
 return {limited,warnings,networks:summaries,unknownDuration,sharedTruncated,unassignedNetworks:jobs.filter(job=>job.schedule?.time&&!job.networks?.length).length};
}
module.exports={analyze};
