'use strict';
const SERVICE='7c0c5f59-c2c8-4c71-9b80-535449530001', CHARACTERISTIC='7c0c5f59-c2c8-4c71-9b80-535449530002';
const BPM_CHARACTERISTIC='7c0c5f59-c2c8-4c71-9b80-535449530003';
const names=['Calm breathing','Fast breathing','Not attached','Shaking'], colors=['#5ed79b','#ff707e','#71adff','#e18aff'];
const $=id=>document.getElementById(id);
let device,characteristic,bpmCharacteristic,lastBpm=0,audio,muted=false,connected=false,busy=false,lastPacket=0,lastInferenceAt=0,lastCounter=null,boot=null,current=null,segments=[],alarmText='',lastBeep=0;
$('legend').innerHTML=names.map((n,i)=>`<span class="swatch" style="background:${colors[i]}"></span>${n} &nbsp;`).join('');
function state(id){
 const now=performance.now();
 if(current===id&&segments.length)return;
 if(segments.length)segments.at(-1).end=now;
 current=id;segments.push({id,start:now,wall:new Date(),end:null});
 if(segments.length>200)segments.shift();
 if(id!==0&&id!==1)$('bpm').textContent='—';
 $('state').textContent=names[id]??id;$('state').style.color=colors[id]??'#b8c9df';
}
function alarm(message){
 alarmText=message;$('alarm').hidden=!message;$('alarm').textContent=message;
 if(message&&!muted&&audio&&performance.now()-lastBeep>2000){
  lastBeep=performance.now();const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=880;g.gain.value=.12;o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.2);
 }
}
function packet(value){
 if(value.byteLength!==12||value.getUint8(0)!==1)throw Error('Unsupported BLE packet');
 const id=value.getUint8(1),newBoot=value.getUint32(2,true),counter=value.getUint32(6,true);
 if(id!==255&&id>3)throw Error('Invalid state');
 if(value.getUint16(10,true)!==250)throw Error('Board is not using a 5-second window');
 const now=performance.now();lastPacket=now;
 if(boot!==newBoot){state('Board restarted / warming up');boot=newBoot;lastCounter=null;}
 if(counter!==lastCounter){lastInferenceAt=now;lastCounter=counter;}
 state(id===255?'Warming up / sensor unavailable':id);
 $('details').textContent=`5-second window · update received ${new Date().toLocaleTimeString()} · inference #${counter}`;
}
function bpmPacket(value){
 if(value.byteLength!==2)throw Error('Unsupported BPM packet');
 const encoded=value.getUint16(0,true);lastBpm=performance.now();
 $('bpm').textContent=connected&&(current===0||current===1)&&encoded!==65535?(encoded/100).toFixed(2):'—';
}
function bpmNotification(event){try{bpmPacket(event.target.value);}catch(e){$('bpm').textContent='—';}}
function notification(event){try{packet(event.target.value);}catch(e){state('Invalid telemetry');alarm(e.message);}}
function lost(){connected=false;bpmCharacteristic?.removeEventListener('characteristicvaluechanged',bpmNotification);bpmCharacteristic=null;characteristic?.removeEventListener('characteristicvaluechanged',notification);characteristic=null;state('Disconnected');$('connection').textContent='Connection lost';$('connect').disabled=false;$('disconnect').disabled=true;alarm('Connection lost — reconnect to resume monitoring.');}
$('connect').onclick=async()=>{
 if(busy)return;busy=true;$('connect').disabled=true;
 try{
  if(!navigator.bluetooth||!isSecureContext)throw Error('Web Bluetooth requires a supported browser and HTTPS or localhost.');
  audio??=new (window.AudioContext||window.webkitAudioContext)();await audio.resume();
  device=await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE]}]});
  device.removeEventListener('gattserverdisconnected',lost);
  device.addEventListener('gattserverdisconnected',lost);
  const server=await device.gatt.connect();const service=await server.getPrimaryService(SERVICE);
  characteristic=await service.getCharacteristic(CHARACTERISTIC);
  characteristic.addEventListener('characteristicvaluechanged',notification);
  connected=true;boot=null;lastCounter=null;lastPacket=lastInferenceAt=performance.now();
  state('Waiting for telemetry');alarm('');
  await characteristic.startNotifications();packet(await characteristic.readValue());
  // Older firmware can continue state monitoring without the optional rate.
  try{
   bpmCharacteristic=await service.getCharacteristic(BPM_CHARACTERISTIC);
   bpmCharacteristic.addEventListener('characteristicvaluechanged',bpmNotification);
   await bpmCharacteristic.startNotifications();bpmPacket(await bpmCharacteristic.readValue());
  }catch(e){bpmCharacteristic?.removeEventListener('characteristicvaluechanged',bpmNotification);bpmCharacteristic=null;$('bpm').textContent='—';}
  $('connection').textContent=`Connected to ${device.name||'StisHik'}`;$('disconnect').disabled=false;
 }catch(e){if(device?.gatt.connected)device.gatt.disconnect();connected=false;state('Disconnected');$('connection').textContent=e.message;$('connect').disabled=false;}
 finally{busy=false;}
};
$('disconnect').onclick=()=>device?.gatt.disconnect();
$('mute').onclick=()=>{muted=!muted;$('mute').textContent=muted?'Enable sound':'Mute sound';if(!muted)audio?.resume();};
function limit(id){const n=Number($(id).value);return Number.isFinite(n)&&n>=1&&n<=3600?n:null;}
function render(){
 const now=performance.now();
 if(now-lastBpm>3000)$('bpm').textContent='—';
 if(connected){
  if(now-lastPacket>5000||now-lastInferenceAt>5000){state('Telemetry unavailable');alarm('Telemetry unavailable — updates or inference have stalled.');}
  else{
   const fast=limit('fast'),unattached=limit('unattached'),elapsed=(now-segments.at(-1).start)/1000;
   if(fast===null||unattached===null)alarm('Enter alarm limits between 1 and 3600 seconds.');
   else if(current===1&&elapsed>=fast)alarm(`Fast breathing for ${Math.floor(elapsed)} seconds (limit ${fast}s).`);
   else if(current===2&&elapsed>=unattached)alarm(`Not attached for ${Math.floor(elapsed)} seconds (limit ${unattached}s).`);
   else alarm('');
  }
 }else if(alarmText)alarm(alarmText);
 const total=segments.reduce((sum,s)=>sum+(s.end??now)-s.start,0)||1;
 $('timeline').replaceChildren(...segments.map(s=>{const div=document.createElement('div');div.className='segment';div.style.background=colors[s.id]??'#617187';div.style.flexGrow=String(((s.end??now)-s.start)/total);div.title=`${names[s.id]??s.id}: ${(((s.end??now)-s.start)/1000).toFixed(1)}s`;return div;}));
 $('events').replaceChildren(...segments.slice().reverse().map(s=>{const tr=document.createElement('tr');for(const text of [s.wall.toLocaleTimeString(),names[s.id]??s.id,`${(((s.end??now)-s.start)/1000).toFixed(1)} s`]){const td=document.createElement('td');td.textContent=text;tr.append(td);}return tr;}));
}
if(!navigator.bluetooth||!isSecureContext){$('connect').disabled=true;$('connection').textContent='Web Bluetooth unavailable here. See browser requirements below.';}
setInterval(render,250);
