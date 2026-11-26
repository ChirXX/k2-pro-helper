/* Моё → Принтер: наблюдение за принтером в локальной сети (только чтение).
   Creality K1 / K2 / Hi / Ender-3 V3: родной WebSocket ws://IP:9999 (тот же, что у Creality Print),
     без пароля. Принтер шлёт полный кадр при подключении, дальше только изменения.
     Описание протокола: github.com/3dg1luk43/ha_creality_ws (docs/internal/reference).
   Klipper (Moonraker): HTTP http://IP:7125/printer/objects/query — Voron, Qidi, Sovol и др.
   Управляющие команды сюда пока НЕ отправляются. */
const PR_TYPES=[['creality','Creality K1 / K2 / Hi / Ender-3 V3'],['moonraker','Klipper (Moonraker): Voron, Qidi, Sovol…']];
const PS={gen:0,form:null,idx:0,ws:null,timer:null,hb:null,data:{},type:'',at:0,status:'off',err:'',cam:false,camPc:null,triedNoProto:false,lastState:'',startedFor:-1};
const prList=()=>store.get('k2printers',[]);
const tfmt=s=>{s=Math.max(0,Math.round(+s||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?`${h} ч ${m} мин`:m?`${m} мин`:`${s} с`};
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:null};
const deg=v=>v==null?'—':Math.round(v)+'°';
const validHost=h=>/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(h)&&!/\.\./.test(h);

/* ---------- нормализованное состояние ---------- */
function crealityView(d){
  const prog=num(d.printProgress)!=null?num(d.printProgress):num(d.dProgress);
  const st=num(d.state),file=d.printFileName||'',err=d.err&&typeof d.err==='object'?+d.err.errcode||0:+d.err||0;
  const paused=st===5||+d.pause===1||+d.paused===1||+d.isPaused===1;
  let s='idle';
  if(+d.withSelfTest>0&&+d.withSelfTest<100)s='selftest';
  else if(err)s='error';
  else if(paused&&file)s='paused';
  else if(st===1&&file)s=prog>=100?'done':'printing';
  else if((st===0||st===7||st===9)&&file)s=prog>=100?'done':'preparing';
  else if(st===2||(file&&prog>=100))s='done';
  else if(st===4)s='stopped';
  return {s,file:file.split('/').pop(),prog,layer:num(d.layer),total:num(d.TotalLayer),
    elapsed:num(d.printJobTime),left:num(d.printLeftTime)!=null?num(d.printLeftTime):num(d.printTimeLeft),
    noz:num(d.nozzleTemp),nozT:num(d.targetNozzleTemp),bed:num(d.bedTemp0),bedT:num(d.targetBedTemp0),
    box:num(d.boxTemp),boxT:num(d.targetBoxTemp),fan:num(d.modelFanPct),speed:num(d.curFeedratePct),
    light:d.lightSw==null?null:+d.lightSw===1,err,model:d.model||'',host:d.hostname||'',
    cam:+d.webrtcSupport===1||/^(F008|F012|F021)$/.test(String(d.model||''))||/k2/i.test(String(d.model||''))?'webrtc':'mjpeg'};
}
function moonView(r){
  const ps=r.print_stats||{},ds=r.display_status||{},vs=r.virtual_sdcard||{},ex=r.extruder||{},hb=r.heater_bed||{};
  const ch=Object.keys(r).filter(k=>/chamber/i.test(k)).map(k=>r[k])[0]||{};
  const p=num(ds.progress)!=null&&ds.progress>0?ds.progress:num(vs.progress)||0;
  const map={printing:'printing',paused:'paused',complete:'done',cancelled:'stopped',error:'error',standby:'idle'};
  const el=num(ps.print_duration);
  return {s:map[ps.state]||'idle',file:(ps.filename||'').split('/').pop(),prog:Math.round(p*1000)/10,
    layer:num((ps.info||{}).current_layer),total:num((ps.info||{}).total_layer),elapsed:el,
    left:p>0.02&&el?el/p-el:null,noz:num(ex.temperature),nozT:num(ex.target),bed:num(hb.temperature),bedT:num(hb.target),
    box:num(ch.temperature),boxT:num(ch.target),fan:r.fan?Math.round((+r.fan.speed||0)*100):null,speed:null,light:null,
    err:ps.state==='error'?1:0,errMsg:ps.message||'',model:'Klipper',host:'',cam:'moon'};
}
const ST_TXT={printing:['🟢','Печатает'],preparing:['🟡','Готовится к печати'],paused:['⏸️','Пауза'],done:['✅','Печать завершена'],
  stopped:['⏹️','Печать остановлена'],error:['🔴','Ошибка'],idle:['⚪','Свободен'],selftest:['🔧','Самопроверка']};

/* ---------- подключение ---------- */
function prDisconnect(){
  clearInterval(PS.timer);clearInterval(PS.hb);PS.timer=PS.hb=null;
  if(PS.ws){const w=PS.ws;PS.ws=null;w.onclose=w.onerror=w.onmessage=null;try{w.close()}catch(e){}}
  camStop();
}
function prConnect(){
  prDisconnect();PS.gen++;
  const P=prList()[PS.idx];PS.data={};PS.at=0;PS.err='';PS.lastState='';PS.triedNoProto=false;
  if(!P){PS.status='off';renderPrinter();return}
  PS.type=P.type;PS.status='connecting';renderPrinter();
  if(P.type==='moonraker')moonStart(P);else crealityStart(P,true);
}
function crealityStart(P,withProto){
  let ws,opened=false;
  try{ws=withProto?new WebSocket(`ws://${P.host}:9999`,['wsslicer']):new WebSocket(`ws://${P.host}:9999`)}
  catch(e){PS.status='fail';PS.err='Не удалось открыть соединение';renderPrinter();return}
  PS.ws=ws;
  setTimeout(()=>{if(!opened&&PS.ws===ws){PS.triedNoProto=true;try{ws.close()}catch(e){}}},8000);
  const send=o=>{try{ws.readyState===1&&ws.send(JSON.stringify(o))}catch(e){}};
  ws.onopen=()=>{opened=true;send({method:'get',params:{ReqPrinterPara:1}});
    clearInterval(PS.timer);clearInterval(PS.hb);
    PS.timer=setInterval(()=>{send({method:'get',params:{ReqPrinterPara:1}});tickStatus()},5000);
    PS.hb=setInterval(()=>send({ModeCode:'heart_beat',msg:new Date().toISOString()}),10000)};
  ws.onmessage=e=>{
    if(typeof e.data!=='string'||e.data==='ok')return;
    let m;try{m=JSON.parse(e.data)}catch(x){return}
    if(!m||typeof m!=='object'||Array.isArray(m))return;
    if(m.ModeCode==='heart_beat'){try{ws.send('ok')}catch(x){};return}
    Object.assign(PS.data,m);PS.at=Date.now();PS.status='on';onTelemetry(crealityView(PS.data));
  };
  ws.onclose=()=>{if(PS.ws!==ws)return;PS.ws=null;clearInterval(PS.timer);clearInterval(PS.hb);
    // часть прошивок не подтверждает подпротокол «wsslicer» — пробуем без него
    if(!opened&&withProto&&!PS.triedNoProto){PS.triedNoProto=true;crealityStart(P,false);return}
    PS.status=PS.at?'lost':'fail';PS.err=PS.at?'Связь с принтером потеряна':'Принтер не отвечает на порту 9999';renderPrinter();
    const g=PS.gen;if(PS.at)setTimeout(()=>{if(g===PS.gen&&!PS.ws&&prVisible()&&PS.status==='lost')prConnect()},5000)};
}
let moonObjs=null;
async function moonStart(P){
  const base=`http://${P.host}:7125`,g=PS.gen;
  const q=async()=>{
    if(g!==PS.gen)return;
    try{
      if(!moonObjs){const L=JSON.parse(await fetchText(base+'/printer/objects/list')).result.objects;
        moonObjs=['print_stats','display_status','virtual_sdcard','extruder','heater_bed','fan',...L.filter(o=>/chamber/i.test(o))].filter(o=>L.includes(o))}
      const r=JSON.parse(await fetchText(base+'/printer/objects/query?'+moonObjs.map(encodeURIComponent).join('&')));
      if(g!==PS.gen)return;PS.at=Date.now();PS.status='on';onTelemetry(moonView(r.result.status));
    }catch(e){if(g!==PS.gen)return;moonObjs=null;PS.status=PS.at?'lost':'fail';PS.err=PS.at?'Связь с принтером потеряна':'Moonraker не отвечает на порту 7125';renderPrinter()}
  };
  moonObjs=null;await q();if(g===PS.gen){clearInterval(PS.timer);PS.timer=setInterval(()=>{q();tickStatus()},3000)}
}
let lastView=null;
function onTelemetry(v){
  // завершение печати — маленький праздник
  if(PS.lastState&&PS.lastState!=='done'&&v.s==='done'){confetti();buzz([30,80,30]);toast('Печать готова! 🎉')}
  if(PS.lastState&&PS.lastState!=='error'&&v.s==='error'){buzz([200,100,200]);toast('Принтер сообщает об ошибке ⚠️')}
  PS.lastState=v.s;lastView=v;renderPrinter();
}
function tickStatus(){const el=$('pr-upd');if(el&&PS.at)el.textContent=updText()}
const updText=()=>{const s=Math.round((Date.now()-PS.at)/1000);return s<3?'обновлено только что':'обновлено '+tfmt(s)+' назад'};
const prVisible=()=>$('s-my').classList.contains('active')&&!$('my-printer').hidden&&!document.hidden;

/* ---------- камера ---------- */
function camStop(){
  if(PS.camPc){try{PS.camPc.close()}catch(e){}PS.camPc=null}
  const box=$('pr-cam');if(box)box.innerHTML='';
}
async function camStart(){
  const P=prList()[PS.idx],box=$('pr-cam');if(!P||!box)return;camStop();
  const kind=lastView?lastView.cam:(P.type==='moonraker'?'moon':'mjpeg');
  box.innerHTML='<div class="cam-msg">Подключаю камеру…</div>';
  try{
    if(kind==='moon'){
      const r=JSON.parse(await fetchText(`http://${P.host}:7125/server/webcams/list`)).result.webcams||[];
      const w=r.find(c=>c.enabled!==false)||r[0];if(!w)throw new Error('В Moonraker не настроена камера');
      const u=/^https?:/.test(w.stream_url)?w.stream_url:`http://${P.host}${w.stream_url.startsWith('/')?'':'/'}${w.stream_url}`;
      box.innerHTML=`<img alt="Камера принтера" src="${esc(u)}" onerror="this.parentNode.innerHTML='<div class=cam-msg>Камера не отвечает</div>'">`;
    }else if(kind==='mjpeg'){
      box.innerHTML=`<img alt="Камера принтера" src="http://${esc(P.host)}:8080/?action=stream" onerror="this.parentNode.innerHTML='<div class=cam-msg>Камера не отвечает на порту 8080</div>'">`;
    }else await camWebRTC(P,box);
  }catch(e){camStop();const net=e.name==='AbortError'||/fetch|network|HTTP/i.test(e.message||'');
    box.innerHTML=`<div class="cam-msg">${net?'Камера не отвечает. Проверь, что камера включена в настройках принтера.':esc(e.message||'Камера не отвечает')}</div>`}
}
// K2: WebRTC, сигнализация POST http://IP:8000/call/webrtc_local (base64 JSON offer). Экспериментально.
async function camWebRTC(P,box){
  if(!window.RTCPeerConnection)throw new Error('Телефон не поддерживает WebRTC');
  const pc=new RTCPeerConnection({iceServers:[]});PS.camPc=pc;
  pc.addTransceiver('video',{direction:'recvonly'});
  const v=document.createElement('video');v.autoplay=v.muted=v.playsInline=true;v.setAttribute('playsinline','');
  pc.ontrack=e=>{v.srcObject=e.streams[0]||new MediaStream([e.track]);box.innerHTML='';box.appendChild(v)};
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise(r=>{if(pc.iceGatheringState==='complete')return r();const t=setTimeout(r,2000);pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(t);r()}}});
  const sdp=pc.localDescription.sdp.replace(/\r?\n/g,'\r\n');
  const txt=await fetchText(`http://${P.host}:8000/call/webrtc_local`,{method:'POST',
    headers:{'Content-Type':'plain/text','Origin':`http://${P.host}:8000`,'Referer':`http://${P.host}:8000/`},body:btoa(JSON.stringify({type:'offer',sdp}))});
  let ans;const t=txt.trim();
  try{ans=JSON.parse(atob(t))}catch(e){try{ans=JSON.parse(t)}catch(x){ans={type:'answer',sdp:t}}}
  if(!ans||!ans.sdp)throw new Error('Камера не ответила');
  await pc.setRemoteDescription({type:'answer',sdp:ans.sdp});
  setTimeout(()=>{if(PS.camPc===pc&&!v.srcObject)box.innerHTML='<div class="cam-msg">Камера K2 не прислала видео. Это экспериментальная функция: на части телефонов принтер не принимает подключение. Смотри камеру в Creality Print.</div>'},10000);
}

/* ---------- отрисовка ---------- */
function prForm(i){
  const P=i>=0?prList()[i]:{n:'',host:'',type:'creality'};
  return `<div class="card open" id="pr-form"><div class="card-b" style="display:block;border:none;padding-top:6px">
    <label class="fl">Название</label><input class="f" id="pf-n" placeholder="Например, «K2 Pro в гараже»" value="${esc(P.n)}">
    <label class="fl">IP-адрес принтера</label><input class="f" id="pf-h" inputmode="url" autocomplete="off" placeholder="192.168.1.50" value="${esc(P.host)}">
    <label class="fl">Тип</label><select class="f" id="pf-t">${PR_TYPES.map(([v,l])=>`<option value="${v}" ${v===P.type?'selected':''}>${l}</option>`).join('')}</select>
    <div class="tip">💡 IP-адрес показан на экране принтера в настройках сети (Wi-Fi / LAN). Телефон должен быть в той же Wi-Fi сети. Лучше закрепить за принтером постоянный адрес в роутере.</div>
    <div class="row">${prList().length?'<button class="btn2" id="pf-cancel">Передумал</button>':''}<button class="btn2 acc" id="pf-save" data-i="${i}">Подключить</button></div>
  </div></div>`;
}
function tile(lbl,cur,tgt){return `<div class="stat"><small>${lbl}</small><b>${deg(cur)}${tgt?`<i> / ${deg(tgt)}</i>`:''}</b></div>`}
function renderPrinter(){
  const box=$('pr-body');if(!box)return;
  const L=prList();
  if(PS.form!=null){box.innerHTML=prForm(PS.form);return}
  if(!L.length){box.innerHTML=emptyBox('📡','Подключи свой принтер','Смотри температуру, прогресс и оставшееся время прямо в телефоне. Нужен только IP-адрес принтера.','<button class="btn2 acc" id="pr-add">＋ Добавить принтер</button>');return}
  const P=L[PS.idx]||L[0],v=PS.status==='on'?lastView:null;
  const chipsH=`<div class="chips">${L.map((p,i)=>`<button class="chip ${i===PS.idx?'on':''}" data-pi="${i}">🖨️ ${esc(p.n||p.host)}</button>`).join('')}<button class="chip" id="pr-add">＋</button></div>`;
  let main;
  if(PS.status==='connecting')main=`<div class="pr-st"><span class="vstatus busy">Подключаюсь к ${esc(P.host)}…</span></div>`;
  else if(PS.status==='fail'||PS.status==='lost')main=emptyBox('🔌',esc(PS.err||'Нет связи'),`Проверь, что принтер включён, телефон в той же Wi-Fi сети, а адрес ${esc(P.host)} верный.`,'<button class="btn2 acc" id="pr-retry">Попробовать снова</button>');
  else if(v){
    const [ico,txt]=ST_TXT[v.s]||ST_TXT.idle,job=['printing','paused','preparing','done'].includes(v.s)&&v.file;
    const eta=v.left>0&&v.s==='printing'?new Date(Date.now()+v.left*1000).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
    main=`<div class="card pr-live s-${v.s}"><div class="pr-top"><span class="pr-pill">${ico} ${txt}</span><span class="vstatus" id="pr-upd">${updText()}</span></div>
      ${v.err?`<div class="warn" style="margin:10px 16px 0">⚠️ Код ошибки: ${esc(String(v.err))}${v.errMsg?' — '+esc(v.errMsg):''}. Подробности — на экране принтера.</div>`:''}
      ${job?`<div class="pr-job">${P.type==='creality'?`<img class="pr-prev" alt="" src="http://${esc(P.host)}/downloads/original/current_print_image.png?t=${encodeURIComponent(v.file)}" onerror="this.remove()">`:''}
        <div class="pr-jt"><b>${esc(v.file)}</b>
        <div class="pr-big">${v.prog!=null?Math.floor(v.prog):0}<small>%</small></div>
        <div class="bar" style="margin:6px 0 0"><i style="width:${Math.min(100,v.prog||0)}%"></i></div></div></div>
        <div class="kv" style="margin:0 16px 4px">
          ${v.layer!=null&&v.total?`<div><span>Слой</span>${v.layer} из ${v.total}</div>`:''}
          ${v.elapsed?`<div><span>Идёт</span>${tfmt(v.elapsed)}</div>`:''}
          ${v.left>0&&v.s!=='done'?`<div><span>Осталось</span>≈ ${tfmt(v.left)}${eta?` · закончит к ${eta}`:''}</div>`:''}
        </div>`:''}
      <div class="stats pr-temps">${tile('Сопло',v.noz,v.nozT)}${tile('Стол',v.bed,v.bedT)}${v.box!=null?tile('Камера',v.box,v.boxT):`<div class="stat"><small>Обдув</small><b>${v.fan!=null?Math.round(v.fan)+' %':'—'}</b></div>`}</div>
      <div class="pr-foot">${v.light!=null?`<span>💡 Подсветка ${v.light?'вкл.':'выкл.'}</span>`:''}${v.speed!=null&&job?`<span>⚡ Скорость ${Math.round(v.speed)} %</span>`:''}${v.model?`<span>${esc(v.host||v.model)}</span>`:''}</div>
    </div>
    <button class="btn2 more" id="pr-camb">${PS.cam?'Скрыть камеру':'📷 Показать камеру'}</button><div id="pr-cam" class="pr-cam" ${PS.cam?'':'hidden'}></div>`;
  }else main=`<div class="pr-st"><span class="vstatus busy">Жду данные от принтера…</span></div>`;
  const keepCam=PS.cam&&$('pr-cam')&&$('pr-cam').firstChild?$('pr-cam'):null;
  box.innerHTML=chipsH+main+`<div class="row"><button class="btn2" id="pr-edit">⚙️ Изменить</button><button class="btn2 del" id="pr-del" style="font-size:14px">Удалить</button></div>
    <p class="sub" style="margin-top:12px">Только наблюдение: приложение ничего не отправляет на принтер, кроме запросов состояния. Работает в той же Wi-Fi сети.</p>`;
  // не пересоздаём видео при каждом обновлении цифр
  if(keepCam&&$('pr-cam')){$('pr-cam').replaceWith(keepCam)}else if(PS.cam&&v&&$('pr-cam')&&!PS.camPc)camStart();
}

/* ---------- события ---------- */
$('my-printer').addEventListener('click',e=>{
  const t=e.target;
  if(t.closest('#pr-add')){PS.form=-1;prDisconnect();renderPrinter();return}
  if(t.closest('#pr-edit')){PS.form=PS.idx;prDisconnect();renderPrinter();return}
  if(t.closest('#pf-cancel')){PS.form=null;prConnect();return}
  if(t.closest('#pr-retry')){prConnect();return}
  if(t.closest('#pr-camb')){PS.cam=!PS.cam;if(!PS.cam)camStop();renderPrinter();return}
  const c=t.closest('[data-pi]');if(c){PS.idx=+c.dataset.pi;store.set('k2printerIdx',PS.idx);PS.cam=false;prConnect();return}
  if(t.closest('#pr-del')){const L=prList(),i=PS.idx,[gone]=L.splice(i,1);store.set('k2printers',L);PS.idx=0;prDisconnect();PS.status='off';
    if(L.length)prConnect();else renderPrinter();buzz(15);
    toast(`«${gone.n||gone.host}» удалён`,()=>{const L2=prList();L2.splice(i,0,gone);store.set('k2printers',L2);PS.idx=i;prConnect()});return}
  const sv=t.closest('#pf-save');if(sv){
    const n=$('pf-n').value.trim(),host=$('pf-h').value.trim().replace(/^[a-z]+:\/\//i,'').replace(/[:/].*$/,''),type=$('pf-t').value;
    if(!validHost(host)){shake($('pf-h'));toast('Похоже, адрес с опечаткой. Пример: 192.168.1.50');return}
    const L=prList(),i=+sv.dataset.i,P={n,host,type};
    if(i>=0)L[i]=P;else L.push(P);store.set('k2printers',L);PS.idx=i>=0?i:L.length-1;store.set('k2printerIdx',PS.idx);
    PS.form=null;PS.cam=false;buzz(10);prConnect();
  }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)prDisconnect();else if(prVisible()&&PS.form==null)prConnect()});
function prShow(){PS.idx=Math.min(store.get('k2printerIdx',0),Math.max(0,prList().length-1));if(PS.form==null)prConnect();else renderPrinter()}
function prHide(){prDisconnect();PS.status='off'}
