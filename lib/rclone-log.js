'use strict';
const {StringDecoder}=require('node:string_decoder');
function redactRclone(value,secrets=[]){
 let text=String(value??'');
 for(const secret of secrets.filter(Boolean))text=text.split(secret).join('[ausgeblendet]');
 text=text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [ausgeblendet]').replace(/\bya29\.[A-Za-z0-9._~-]+/g,'[ausgeblendet]');
 return text.replace(/((?:["']?)(?:access_token|refresh_token|client_secret|client_id|id_token|authorization|password|token)(?:["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s&,;]+)/gi,'$1[ausgeblendet]');
}
function createRcloneOutput({log,onStats=()=>{},onError=()=>{},secrets=()=>[]}){
 const streams=new Map();
 function line(value){
  if(!value.trim())return;
  let record;try{record=JSON.parse(value);}catch{}
  if(record && typeof record==='object'){
   if(record.stats)onStats(record.stats);
   if(record.stats&&!['error','critical','fatal','warning'].includes(String(record.level).toLowerCase()))return;
   const parts=[record.time,record.level,record.object,record.msg,typeof record.error==='string'?record.error:null].filter(item=>typeof item==='string'&&item);
   if(!parts.length)return;
   const text=redactRclone(parts.join(' · '),secrets()).slice(0,8192);log(text+'\n');
   if(['error','critical','fatal'].includes(String(record.level).toLowerCase()))onError(text.slice(0,1200));
  }else{
   const text=redactRclone(value,secrets()).slice(0,8192);log(text+'\n');
   if(/error|failed|fatal/i.test(text))onError(text.slice(0,1200));
  }
 }
 function push(chunk,channel='stderr'){
  if(!streams.has(channel))streams.set(channel,{decoder:new StringDecoder('utf8'),buffer:'',discard:false});
  const stream=streams.get(channel),parts=stream.decoder.write(chunk).split('\n');
  for(let index=0;index<parts.length;index++){
   if(!stream.discard){stream.buffer+=parts[index];if(stream.buffer.length>65536){stream.buffer='';stream.discard=true;log('Rclone: überlange Protokollzeile ausgelassen.\n');}}
   if(index<parts.length-1){if(!stream.discard)line(stream.buffer);stream.buffer='';stream.discard=false;}
  }
 }
 function end(){for(const stream of streams.values()){const tail=stream.decoder.end();if(!stream.discard)line(stream.buffer+tail);stream.buffer='';}}
 return {push,end};
}
module.exports={redactRclone,createRcloneOutput};
