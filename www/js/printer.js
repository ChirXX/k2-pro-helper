/* Моё → Принтер: наблюдение за принтером в локальной сети (только чтение).
   Creality K1 / K2 / Hi / Ender-3 V3: родной WebSocket ws://IP:9999 (тот же, что у Creality Print),
     без пароля. Принтер шлёт полный кадр при подключении, дальше только изменения.
     Описание протокола: github.com/3dg1luk43/ha_creality_ws (docs/internal/reference).
   Klipper (Moonraker): HTTP http://IP:7125/printer/objects/query — Voron, Qidi, Sovol и др.
   Управление (если включено в настройках принтера): пауза, продолжение, стоп, подсветка, температуры, скорость.
   Опасные действия — только после подтверждения. */
const PR_TYPES=[['creality','Creality K1 / K2 / Hi / Ender-3 V3'],['moonraker','Klipper (Moonraker): Voron, Qidi, Sovol…']];
const PS={notif:{},job:null,gen:0,form:null,idx:0,ws:null,timer:null,hb:null,data:{},type:'',at:0,status:'off',err:'',cam:false,camPc:null,triedNoProto:false,lastState:'',startedFor:-1};
const prList=()=>store.get('k2printers',[]);
const tfmt=s=>{s=Math.max(0,Math.round(+s||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?`${h} ч ${m} мин`:m?`${m} мин`:`${s} с`};
const num=v=>{const n=parseFloat(v);return isFinite(n)?n:null};
const deg=v=>v==null?'—':Math.round(v)+'°';
const onCell=()=>{const c=navigator.connection;return !!c&&c.type==='cellular'};
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
    mm:num(d.usedMaterialLength),maxNoz:num(d.maxNozzleTemp)||300,maxBed:num(d.maxBedTemp)||100,maxBox:num(d.maxBoxTemp)||60,boxCtl:'targetBoxTemp' in d&&'maxBoxTemp' in d,
    cam:+d.webrtcSupport===1||/^(F008|F012|F021)$/.test(String(d.model||''))||/k2/i.test(String(d.model||''))?'webrtc':'mjpeg'};
}
function moonView(r){
  const ps=r.print_stats||{},ds=r.display_status||{},vs=r.virtual_sdcard||{},ex=r.extruder||{},hb=r.heater_bed||{};
  const chKey=Object.keys(r).filter(k=>/chamber/i.test(k))[0],ch=chKey?r[chKey]:{};
  PS.moonChamber=chKey&&/^heater_generic /.test(chKey)?chKey.slice(15):'';
  const p=num(ds.progress)!=null&&ds.progress>0?ds.progress:num(vs.progress)||0;
  const map={printing:'printing',paused:'paused',complete:'done',cancelled:'stopped',error:'error',standby:'idle'};
  const el=num(ps.print_duration);
  return {s:map[ps.state]||'idle',file:(ps.filename||'').split('/').pop(),prog:Math.round(p*1000)/10,
    layer:num((ps.info||{}).current_layer),total:num((ps.info||{}).total_layer),elapsed:el,
    left:p>0.02&&el?el/p-el:null,noz:num(ex.temperature),nozT:num(ex.target),bed:num(hb.temperature),bedT:num(hb.target),
    box:num(ch.temperature),boxT:num(ch.target),fan:r.fan?Math.round((+r.fan.speed||0)*100):null,
    speed:r.gcode_move&&num(r.gcode_move.speed_factor)!=null?r.gcode_move.speed_factor*100:null,light:null,
    mm:num(ps.filament_used),maxNoz:300,maxBed:120,maxBox:70,boxCtl:!!PS.moonChamber,
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
        moonObjs=['print_stats','display_status','virtual_sdcard','extruder','heater_bed','fan','gcode_move',...L.filter(o=>/chamber/i.test(o))].filter(o=>L.includes(o))}
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
  const P=prList()[PS.idx];
  if(P){
    try{jAuto(P,v,PS.job)}catch(e){}
    notifySync(P,v);
  }
  // помним последнюю активную печать — чтобы записать её, если её остановят
  if(['printing','paused','preparing'].includes(v.s)&&v.file)PS.job={file:v.file,elapsed:v.elapsed,mm:v.mm};
  else if(v.s!=='done')PS.job=null;
  PS.lastState=v.s;lastView=v;renderPrinter();
}

/* уведомление «печать готова» — планируется на время окончания, приходит даже при закрытом приложении */
const LN=()=>window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.LocalNotifications;
const nid=P=>{let h=0;for(const c of P.host)h=(h*31+c.charCodeAt(0))%90000;return 10000+h};
async function notifySync(P,v){
  const ln=LN();if(!ln)return;const id=nid(P);
  if(P.nt===false||!(v.s==='printing'&&v.left>90)){
    if(PS.notif[id]>Date.now()){ln.cancel({notifications:[{id}]}).catch(()=>{})}PS.notif[id]=0;return}
  const at=Date.now()+v.left*1000;
  if(PS.notif[id]&&Math.abs(PS.notif[id]-at)<180000)return;
  PS.notif[id]=at;
  try{const p=await ln.checkPermissions();if(p.display!=='granted')return;
    await ln.schedule({notifications:[{id,title:'Печать должна быть готова ✅',
      body:`«${v.file}» на «${P.n||P.host}» — по расчёту принтера. Загляни проверить!`,schedule:{at:new Date(at),allowWhileIdle:true}}]})}
  catch(e){}
}
async function askNotify(){const ln=LN();if(!ln)return;
  try{const p=await ln.checkPermissions();if(p.display!=='granted'){const r=await ln.requestPermissions();if(r.display!=='granted')toast('Без разрешения уведомления не придут — его можно дать в настройках Android')}}catch(e){}}
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

/* ---------- отрисовка ----------
   Данные приходят несколько раз в секунду. Перерисовывать панель целиком нельзя: картинка «прыгает»,
   а видео камеры при каждом пересоздании останавливается. Поэтому меняем только то, что изменилось. */
function morph(a,b){
  if(a.nodeType!==b.nodeType||a.nodeName!==b.nodeName||(a.id==='pr-cam')!==(b.id==='pr-cam')){a.replaceWith(b);return}
  if(a.nodeType===3||a.nodeType===8){if(a.data!==b.data)a.data=b.data;return}
  if(a.nodeType!==1||a.id==='pr-cam'||a.isEqualNode(b))return;
  for(const at of [...a.attributes])if(!b.hasAttribute(at.name))a.removeAttribute(at.name);
  for(const at of [...b.attributes])if(a.getAttribute(at.name)!==at.value)a.setAttribute(at.name,at.value);
  morphKids(a,b);
}
function morphKids(a,b){
  const ac=[...a.childNodes],bc=[...b.childNodes];
  bc.forEach((n,i)=>{if(i<ac.length)morph(ac[i],n);else a.appendChild(n)});
  for(let i=bc.length;i<ac.length;i++)ac[i].remove();
}
function patchHTML(box,html){const t=document.createElement('div');t.innerHTML=html;morphKids(box,t)}
const prevBad=new Set();
function prevFail(img){prevBad.add(img.getAttribute('src'));img.remove()}
function prForm(i){
  const P=i>=0?prList()[i]:{n:'',host:'',type:'creality',ctl:true,nt:true};
  return `<div class="card open" id="pr-form"><div class="card-b" style="display:block;border:none;padding-top:6px">
    <label class="fl">Название</label><input class="f" id="pf-n" placeholder="Например, «K2 Pro в гараже»" value="${esc(P.n)}">
    <label class="fl">IP-адрес принтера</label><input class="f" id="pf-h" inputmode="url" autocomplete="off" placeholder="192.168.1.50" value="${esc(P.host)}">
    <label class="fl">Тип</label><select class="f" id="pf-t">${PR_TYPES.map(([v,l])=>`<option value="${v}" ${v===P.type?'selected':''}>${l}</option>`).join('')}</select>
    <label class="ck"><input type="checkbox" id="pf-c" ${P.ctl!==false?'checked':''}> Разрешить управление: пауза, стоп, температуры, скорость, подсветка</label>
    <label class="ck"><input type="checkbox" id="pf-nt" ${P.nt!==false?'checked':''}> Уведомить, когда печать должна закончиться — даже если приложение закрыто</label>
    <div class="tip">💡 IP-адрес показан на экране принтера в настройках сети (Wi-Fi / LAN). Телефон должен быть в той же Wi-Fi сети — из мобильного интернета принтер напрямую не виден. Лучше закрепить за принтером постоянный адрес в роутере.</div>
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
  else if(PS.status==='fail'||PS.status==='lost')main=emptyBox(onCell()?'📶':'🔌',onCell()?'Телефон в мобильном интернете':esc(PS.err||'Нет связи'),
    onCell()?`Из мобильного интернета до домашнего адреса ${esc(P.host)} не достучаться — он виден только внутри домашней сети. Подключись к домашнему Wi-Fi или включи VPN домой (см. «Смотреть принтер не из дома» ниже).`
    :`Проверь, что принтер включён, телефон в той же Wi-Fi сети (или включён VPN домой), а адрес ${esc(P.host)} верный.`,'<button class="btn2 acc" id="pr-retry">Попробовать снова</button>');
  else if(v){
    const [ico,txt]=ST_TXT[v.s]||ST_TXT.idle,job=['printing','paused','preparing','done'].includes(v.s)&&v.file;
    const prevSrc=`http://${P.host}/downloads/original/current_print_image.png?t=${encodeURIComponent(v.file)}`;
    const eta=v.left>0&&v.s==='printing'?new Date(Date.now()+v.left*1000).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
    main=`<div class="card pr-live s-${v.s}"><div class="pr-top"><span class="pr-pill">${ico} ${txt}</span><span class="vstatus" id="pr-upd">${updText()}</span></div>
      ${v.err?`<div class="warn" style="margin:10px 16px 0">⚠️ Код ошибки: ${esc(String(v.err))}${v.errMsg?' — '+esc(v.errMsg):''}. Подробности — на экране принтера.</div>`:''}
      ${job?`<div class="pr-job">${P.type==='creality'&&!prevBad.has(prevSrc)?`<img class="pr-prev" alt="" src="${esc(prevSrc)}" onerror="prevFail(this)">`:''}
        <div class="pr-jt"><b>${esc(v.file)}</b>
        <div class="pr-big">${v.prog!=null?Math.floor(v.prog):0}<small>%</small></div>
        <div class="bar" style="margin:6px 0 0"><i style="width:${Math.min(100,v.prog||0)}%"></i></div></div></div>
        <div class="kv" style="margin:0 16px 4px">
          ${v.layer!=null&&v.total?`<div><span>Слой</span>${v.layer} из ${v.total}</div>`:''}
          ${v.elapsed?`<div><span>Идёт</span>${tfmt(v.elapsed)}</div>`:''}
          ${v.left>0&&v.s!=='done'?`<div><span>Осталось</span>≈ ${tfmt(v.left)}${eta?` · закончит к ${eta}`:''}</div>`:''}
        </div>`:''}
      <div class="stats pr-temps">${tile('Сопло',v.noz,v.nozT)}${tile('Стол',v.bed,v.bedT)}${v.box!=null?tile('Камера',v.box,v.boxT):`<div class="stat"><small>Обдув</small><b>${v.fan!=null?Math.round(v.fan)+' %':'—'}</b></div>`}</div>
      ${P.ctl!==false?ctlHTML(P,v,job):''}
      <div class="pr-foot">${v.light!=null?`<span>💡 Подсветка ${v.light?'вкл.':'выкл.'}</span>`:''}${v.speed!=null&&job?`<span>⚡ Скорость ${Math.round(v.speed)} %</span>`:''}${v.model?`<span>${esc(v.host||v.model)}</span>`:''}</div>
    </div>
    <button class="btn2 more" id="pr-camb">${PS.cam?'Скрыть камеру':'📷 Показать камеру'}</button><div id="pr-cam" class="pr-cam" hidden></div>`;
  }else main=`<div class="pr-st"><span class="vstatus busy">Жду данные от принтера…</span></div>`;
  const html=chipsH+main+`<div class="row"><button class="btn2" id="pr-edit">⚙️ Изменить</button><button class="btn2 del" id="pr-del" style="font-size:14px">Удалить</button></div>
    <p class="sub" style="margin-top:12px">${P.ctl!==false?'Управление работает в той же Wi-Fi сети. Остановка печати и смена температур во время печати просят подтверждение.':'Только наблюдение: команды на принтер не отправляются. Включить управление — в «⚙️ Изменить».'}</p>`;
  patchHTML(box,html);
  const cam=$('pr-cam');if(cam){cam.hidden=!PS.cam;if(PS.cam&&!cam.firstChild)camStart()}
}

/* ---------- события ---------- */
$('my-printer').addEventListener('click',e=>{
  const t=e.target;
  if(t.closest('#pr-add')){PS.form=-1;prDisconnect();renderPrinter();return}
  if(t.closest('#pr-edit')){PS.form=PS.idx;prDisconnect();renderPrinter();return}
  if(t.closest('#pf-cancel')){PS.form=null;prConnect();return}
  if(t.closest('#pr-retry')){prConnect();return}
  const pc=t.closest('[data-pc]');if(pc){onCtl(pc.dataset.pc);return}
  if(t.closest('#pr-camb')){PS.cam=!PS.cam;if(!PS.cam)camStop();renderPrinter();return}
  const c=t.closest('[data-pi]');if(c){PS.idx=+c.dataset.pi;store.set('k2printerIdx',PS.idx);PS.cam=false;prConnect();return}
  if(t.closest('#pr-del')){const L=prList(),i=PS.idx,[gone]=L.splice(i,1);store.set('k2printers',L);PS.idx=0;prDisconnect();PS.status='off';
    if(L.length)prConnect();else renderPrinter();buzz(15);
    toast(`«${gone.n||gone.host}» удалён`,()=>{const L2=prList();L2.splice(i,0,gone);store.set('k2printers',L2);PS.idx=i;prConnect()});return}
  const sv=t.closest('#pf-save');if(sv){
    const ctl=$('pf-c').checked,nt=$('pf-nt').checked,n=$('pf-n').value.trim(),host=$('pf-h').value.trim().replace(/^[a-z]+:\/\//i,'').replace(/[:/].*$/,''),type=$('pf-t').value;
    if(!validHost(host)){shake($('pf-h'));toast('Похоже, адрес с опечаткой. Пример: 192.168.1.50');return}
    const L=prList(),i=+sv.dataset.i,P={n,host,type,ctl,nt};if(nt)askNotify();
    if(i>=0)L[i]=P;else L.push(P);store.set('k2printers',L);PS.idx=i>=0?i:L.length-1;store.set('k2printerIdx',PS.idx);
    PS.form=null;PS.cam=false;buzz(10);prConnect();
  }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)prDisconnect();else if(prVisible()&&PS.form==null)prConnect()});
function prShow(){if(!store.get('k2ntAsked',false)&&prList().some(p=>p.nt!==false)&&LN()){store.set('k2ntAsked',true);askNotify()}PS.idx=Math.min(store.get('k2printerIdx',0),Math.max(0,prList().length-1));if(PS.form==null)prConnect();else renderPrinter()}
function prHide(){prDisconnect();PS.status='off'}

/* ---------- управление ---------- */
function ctlHTML(P,v,job){
  const b=(k,l,c='')=>`<button class="btn2 ${c}" data-pc="${k}">${l}</button>`;
  const active=['printing','preparing','paused'].includes(v.s)&&v.file;
  return `<div class="pr-ctl">
    ${active&&v.s!=='paused'?b('pause','⏸ Пауза'):''}${v.s==='paused'?b('resume','▶ Продолжить','acc'):''}${active?b('stop','⏹ Стоп','danger'):''}
    ${v.light!=null?b('light',v.light?'💡 Свет выкл.':'💡 Свет вкл.'):''}
    ${b('temps','🌡 Температуры')}${v.speed!=null||P.type==='moonraker'?b('speed','⚡ Скорость'+(v.speed!=null?' '+Math.round(v.speed)+' %':'')):''}
  </div>`;
}
function sheet(html){
  closeSheet(true);const o=document.createElement('div');o.id='sheet';
  o.innerHTML=`<div class="sh-bg"></div><div class="sh" role="dialog">${html}</div>`;document.body.appendChild(o);
  requestAnimationFrame(()=>o.classList.add('show'));return o;
}
function closeSheet(now){const o=$('sheet');if(!o)return;o.id='';o.classList.remove('show');if(now)o.remove();else setTimeout(()=>o.remove(),250)}
function ask(title,text,ok,danger){
  return new Promise(res=>{
    const o=sheet(`<b class="sh-t">${title}</b><p class="sh-p">${text}</p><div class="row"><button class="btn2" data-a="0">Отмена</button><button class="btn2 ${danger?'danger':'acc'}" data-a="1">${ok}</button></div>`);
    o.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(b||e.target.classList.contains('sh-bg')){closeSheet();res(!!b&&b.dataset.a==='1')}});
  });
}
async function prCmd(kind,val){
  const P=prList()[PS.idx];if(!P)throw new Error('Принтер не выбран');
  if(P.type==='creality'){
    const map={pause:{pause:1},resume:{pause:0},stop:{stop:1},light:{lightSw:val?1:0},noz:{nozzleTempControl:val},
      bed:{bedTempControl:{num:0,val}},box:{boxTempControl:val},speed:{setFeedratePct:val}};
    if(!PS.ws||PS.ws.readyState!==1)throw new Error('Нет связи с принтером');
    PS.ws.send(JSON.stringify({method:'set',params:map[kind]}));
    setTimeout(()=>{try{PS.ws&&PS.ws.readyState===1&&PS.ws.send(JSON.stringify({method:'get',params:{ReqPrinterPara:1}}))}catch(e){}},700);
    return;
  }
  const base=`http://${P.host}:7125`,post=u=>fetchText(base+u,{method:'POST'});
  const g=c=>post('/printer/gcode/script?script='+encodeURIComponent(c));
  if(kind==='pause')await post('/printer/print/pause');
  else if(kind==='resume')await post('/printer/print/resume');
  else if(kind==='stop')await post('/printer/print/cancel');
  else if(kind==='noz')await g(`SET_HEATER_TEMPERATURE HEATER=extruder TARGET=${val}`);
  else if(kind==='bed')await g(`SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=${val}`);
  else if(kind==='box'&&PS.moonChamber)await g(`SET_HEATER_TEMPERATURE HEATER=${PS.moonChamber} TARGET=${val}`);
  else if(kind==='speed')await g(`M220 S${val}`);
}
async function run(kind,val,okMsg){
  try{await prCmd(kind,val);buzz(12);toast(okMsg)}
  catch(e){toast('Не получилось: '+(e.name==='AbortError'||/fetch/i.test(e.message)?'принтер не ответил':e.message))}
}
const TPRESET=[['PLA',210,60],['PETG',240,75],['ABS / ASA',250,100],['Остудить',0,0]];
async function onCtl(k){
  const v=lastView;if(!v)return;const printing=['printing','preparing'].includes(v.s);
  if(k==='pause'){if(await ask('Поставить на паузу?','Сопло отъедет от модели, печать можно будет продолжить.','Пауза'))run('pause',0,'Ставлю на паузу ⏸');return}
  if(k==='resume'){run('resume',0,'Продолжаю печать ▶');return}
  if(k==='stop'){if(await ask('Остановить печать?','Печать «'+esc(v.file)+'» будет прервана. Продолжить её потом не получится.','Остановить',true))run('stop',0,'Останавливаю печать ⏹');return}
  if(k==='light'){run('light',!v.light,v.light?'Выключаю подсветку':'Включаю подсветку 💡');return}
  if(k==='temps'){
    const row=(id,l,cur,max)=>`<label class="fl">${l} <span class="sh-cur">задано ${deg(cur)}, макс. ${max}°</span></label><input class="f" type="number" inputmode="numeric" min="0" max="${max}" id="${id}" value="${cur!=null?Math.round(cur):0}">`;
    const o=sheet(`<b class="sh-t">🌡 Температуры</b>
      <div class="chips" style="padding-top:8px">${TPRESET.map(([n,a,b])=>`<button class="chip" data-tp="${a},${b}">${n}${a?` ${a}/${b}°`:''}</button>`).join('')}</div>
      ${row('t-noz','Сопло',v.nozT,v.maxNoz)}${row('t-bed','Стол',v.bedT,v.maxBed)}${v.boxCtl?row('t-box','Камера (подогрев)',v.boxT,v.maxBox):''}
      <p class="sh-p" style="font-size:13px">Заданные значения уже стоят в полях. 0 — выключить нагрев. Температуры для своего пластика смотри на катушке и в Справочнике → «Материалы».</p>
      <div class="row"><button class="btn2" data-x="0">Отмена</button><button class="btn2 acc" data-x="1">Установить</button></div>`);
    o.addEventListener('click',async e=>{
      const tp=e.target.closest('[data-tp]');if(tp){const [a,b]=tp.dataset.tp.split(',');$('t-noz').value=a;$('t-bed').value=b;return}
      const x=e.target.closest('[data-x]');if(!x&&!e.target.classList.contains('sh-bg'))return;
      if(!x||x.dataset.x==='0'){closeSheet();return}
      const want=[['noz','t-noz',v.nozT,v.maxNoz,'сопло'],['bed','t-bed',v.bedT,v.maxBed,'стол'],['box','t-box',v.boxT,v.maxBox,'камера']].filter(a=>$(a[1]));
      const ch=[];for(const [kind,id,cur,max,nm] of want){const n=Math.round(+$(id).value);
        if(!isFinite(n)||n<0||n>max){shake($(id));toast(`Для «${nm}» можно от 0 до ${max}°`);return}
        if(n!==Math.round(cur||0))ch.push([kind,n,nm])}
      closeSheet();if(!ch.length){toast('Ничего не изменилось');return}
      if(printing&&!await ask('Идёт печать','Резкая смена температуры может испортить модель: '+ch.map(c=>c[2]+' → '+c[1]+'°').join(', ')+'. Точно меняем?','Изменить',true))return;
      for(const [kind,n] of ch)await prCmd(kind,n).catch(e=>toast('Не получилось: '+e.message));
      buzz(12);toast('Температуры отправлены 🌡');
    });return}
  if(k==='speed'){
    const cur=Math.round(v.speed||100);
    const o=sheet(`<b class="sh-t">⚡ Скорость печати</b><div class="sp-val"><span id="sp-n">${cur}</span> %</div>
      <input type="range" id="sp-r" min="30" max="200" step="5" value="${cur}">
      <div class="chips" style="padding-top:10px">${[[50,'🐢 50 %'],[75,'75 %'],[100,'100 % — как в слайсере'],[125,'125 %'],[150,'🐇 150 %']].map(([n,l])=>`<button class="chip" data-sp="${n}">${l}</button>`).join('')}</div>
      <p class="sh-p" style="font-size:13px">Меняет скорость текущей печати. Быстрее — выше риск недоэкструзии и хуже поверхность; медленнее помогает на сложных участках.</p>
      <div class="row"><button class="btn2" data-x="0">Отмена</button><button class="btn2 acc" data-x="1">Применить</button></div>`);
    o.addEventListener('input',()=>{$('sp-n').textContent=$('sp-r').value});
    o.addEventListener('click',e=>{const c=e.target.closest('[data-sp]');if(c){$('sp-r').value=c.dataset.sp;$('sp-n').textContent=c.dataset.sp;return}
      const x=e.target.closest('[data-x]');if(!x&&!e.target.classList.contains('sh-bg'))return;
      const n=+$('sp-r').value;closeSheet();if(x&&x.dataset.x==='1'&&n!==cur)run('speed',n,`Скорость ${n} % ⚡`)});
  }
}
