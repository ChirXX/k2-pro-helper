/* Моё → Журнал печати и учёт: пластик, время, электричество и деньги — по дням и месяцам.
   Записи создаются сами, когда подключённый принтер заканчивает или прерывает печать: пока приложение открыто —
   отсюда, а когда закрыто — их замечает виджет на главном экране (PrinterWidget.java) и отдаёт при следующем запуске.
   Вручную можно записать печать любого принтера. Вес считается из длины прутка 1,75 мм и плотности материала,
   электричество — из средней мощности принтера и времени печати. Цены общие с калькулятором «Стоимость печати». */
const J_MATS=[['PLA',1.24],['PETG',1.27],['ABS',1.04],['ASA',1.07],['TPU',1.21],['PC',1.20],['PA (нейлон)',1.14],['Другой',1.24]];
const J_RES={ok:['✅','Удачно'],fail:['❌','Брак'],stop:['⏹️','Остановлена']};
const J_MON=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const J_MON_G=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const jList=()=>store.get('k2journal',[]);
const jDens=m=>(J_MATS.find(x=>x[0]===m)||J_MATS[0])[1];
const mmToG=(mm,m)=>mm>0?Math.PI*0.875*0.875*mm/1000*jDens(m):0; // мм³ → см³ × г/см³
const jG=e=>e.g!=null&&e.g!==''?+e.g:Math.round(mmToG(+e.mm||0,e.mat)*10)/10;
const jPrice=()=>{const c=store.get('k2calc',{kg:20,cur:'€',watt:150,kwh:0.25});
  return {kg:+c.kg||0,cur:c.cur||'€',watt:c.watt!=null?+c.watt||0:150,kwh:c.kwh!=null?+c.kwh||0:0.25}};
const jKwh=(e,p)=>(+e.dur||0)/3600*(e.w!=null?+e.w:p.watt)/1000;
const moneyRaw=(v,cur)=>v.toLocaleString('ru-RU',{maximumFractionDigits:2,minimumFractionDigits:2})+' '+cur;
const money=(v,cur)=>esc(moneyRaw(v,cur));
const grams=g=>g>=1000?(g/1000).toLocaleString('ru-RU',{maximumFractionDigits:2})+' кг':Math.round(g)+' г';
const kwhTxt=k=>k.toLocaleString('ru-RU',{maximumFractionDigits:k<10?2:1})+' кВт·ч';
const hrs=s=>{const h=s/3600;return h<1?Math.round(s/60)+' мин':h.toLocaleString('ru-RU',{maximumFractionDigits:1})+' ч'};
const ymKey=t=>{const d=new Date(t);return d.getFullYear()*100+d.getMonth()};
const ymName=k=>J_MON[k%100]+' '+Math.floor(k/100);
let jOpen=-1,jForm=false,jFilter='all',jYM=ymKey(Date.now()),jDay=0,jSet=false;

/* ---------- автоматическая запись ---------- */
// одна и та же печать могла прийти и от приложения, и от виджета — сверяем принтер, файл и время
function jDup(L,host,pr,f,at){return L.some(x=>x.f===f&&(x.h?x.h===host:x.pr===pr)&&Math.abs(x.at-at)<4*3600e3)}
function jAdd(L,e){
  if(jDup(L,e.h,e.pr,e.f,e.at))return false;
  L.push({id:e.at+Math.floor(Math.random()*1000),at:e.at,f:e.f,h:e.h,pr:e.pr,dur:Math.round(e.dur||0),mm:Math.round(e.mm||0),mat:'PLA',res:e.res,note:'',auto:true});
  return true;
}
function jSave(L){L.sort((a,b)=>b.at-a.at);store.set('k2journal',L.slice(0,3000))}
function jAuto(P,v,prevJob){ // вызывается из printer.js
  let e=null;
  if(v.s==='done'&&v.file&&(v.elapsed||0)>60)e={f:v.file,dur:v.elapsed,mm:v.mm,res:'ok'};
  else if((v.s==='stopped'||v.s==='error')&&prevJob&&prevJob.file)e={f:prevJob.file,dur:prevJob.elapsed,mm:prevJob.mm,res:v.s==='error'?'fail':'stop'};
  if(!e)return;
  const L=jList();
  if(!jAdd(L,{...e,at:Date.now(),h:P.host,pr:P.n||P.host}))return;
  jSave(L);
  toast(e.res==='ok'?'Записал печать в журнал 📒':'Отметил прерванную печать в журнале');
  if(!$('my-journal').hidden)renderJournal();
}
// печати, которые виджет записал, пока приложение было закрыто
async function jTakeNative(){
  const h=window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.Home;if(!h||!h.takePrints)return;
  try{const r=await h.takePrints(),N=(r&&r.prints)||[];if(!N.length)return;
    const L=jList();let n=0;N.forEach(e=>{if(e&&e.f&&jAdd(L,e))n++});
    if(n){jSave(L);toast(n===1?'В журнал добавлена печать, пока приложение было закрыто 📒':`В журнал добавлено печатей: ${n} 📒`);if(!$('my-journal').hidden)renderJournal()}
  }catch(e){}
}
jTakeNative();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)jTakeNative()});

/* ---------- подсчёт ---------- */
function jStats(L){
  const p=jPrice();let n=0,ok=0,sec=0,g=0,kwh=0;
  L.forEach(e=>{n++;if(e.res==='ok')ok++;sec+=+e.dur||0;g+=jG(e);kwh+=jKwh(e,p)});
  const cm=g/1000*p.kg,ce=kwh*p.kwh;
  return {n,ok,pct:n?Math.round(ok/n*100):0,sec,g,kwh,cm,ce,cost:cm+ce,cur:p.cur};
}
function statBox(t,s,sub){return `<div class="card j-stat"><div class="grp-h"><b>${t}</b>${sub||''}</div><div class="stats" style="padding:0 16px 14px">
  <div class="stat"><small>Печатей</small><b>${s.n}</b></div><div class="stat"><small>Удачных</small><b>${s.n?s.pct+' %':'—'}</b></div><div class="stat"><small>Время</small><b>${hrs(s.sec)}</b></div>
  <div class="stat"><small>Пластик</small><b>${grams(s.g)}</b></div><div class="stat"><small>Электричество</small><b>${kwhTxt(s.kwh)}</b></div><div class="stat"><small>Всего</small><b>${money(s.cost,s.cur)}</b></div>
  <div class="stat j-wide"><small>Из них: пластик ${money(s.cm,s.cur)} · свет ${money(s.ce,s.cur)}</small></div></div></div>`}

// столбики по дням месяца: высота — часы печати
function dayChart(M,ym){
  const y=Math.floor(ym/100),m=ym%100,days=new Date(y,m+1,0).getDate(),sec=Array(days+1).fill(0),cnt=Array(days+1).fill(0);
  M.forEach(e=>{const d=new Date(e.at).getDate();sec[d]+=+e.dur||0;cnt[d]++});
  const max=Math.max(...sec,1),today=new Date(),isCur=ymKey(today)===ym;
  let bars='';
  for(let d=1;d<=days;d++){
    const h=sec[d]?Math.max(8,Math.round(sec[d]/max*100)):0;
    bars+=`<button class="j-bar ${jDay===d?'on':''} ${isCur&&today.getDate()===d?'today':''}" data-jday="${d}" aria-label="${d} число: ${cnt[d]} печат., ${hrs(sec[d])}">
      <i style="height:${h}%"></i><span>${d===1||d%5===0||d===days?d:''}</span></button>`;
  }
  return `<div class="card j-chart"><div class="grp-h"><b>По дням</b><em>${jDay?'выбран '+jDay+' число — нажми ещё раз, чтобы снять':'часы печати; нажми на день'}</em></div><div class="j-bars">${bars}</div></div>`;
}
function monthTable(L){
  const by=new Map();L.forEach(e=>{const k=ymKey(e.at);if(!by.has(k))by.set(k,[]);by.get(k).push(e)});
  const keys=[...by.keys()].sort((a,b)=>b-a);if(keys.length<2)return '';
  const rows=keys.map(k=>{const s=jStats(by.get(k));
    return `<button class="j-mrow ${k===jYM?'on':''}" data-jym="${k}"><b>${ymName(k)}</b><span>${s.n} печ. · ${hrs(s.sec)} · ${grams(s.g)} · ${kwhTxt(s.kwh)}</span><em>${money(s.cost,s.cur)}</em></button>`}).join('');
  return `<div class="card"><div class="grp-h"><b>По месяцам</b></div><div class="j-mtab">${rows}</div></div>`;
}
function setHTML(){
  const p=jPrice();
  return `<div class="card open"><div class="grp-h"><b>⚙️ Цены и мощность</b></div><div class="card-b" style="display:block;border:none;padding-top:0">
    <div class="fgrid">
      <div><label>Пластик, за 1 кг</label><input class="f" type="number" inputmode="decimal" min="0" id="js-kg" value="${p.kg}"></div>
      <div><label>Валюта</label><input class="f" id="js-cur" value="${esc(p.cur)}"></div>
      <div><label>Принтер в среднем, Вт</label><input class="f" type="number" inputmode="decimal" min="0" id="js-w" value="${p.watt}"></div>
      <div><label>Цена за кВт·ч</label><input class="f" type="number" inputmode="decimal" min="0" id="js-kwh" value="${p.kwh}"></div></div>
    <p class="sub" style="margin:8px 2px 0">K2 / K1 при печати PLA тратят в среднем 150–300 Вт (больше всего — нагрев стола и камеры). Точнее покажет розетка-ваттметр. Цена за кВт·ч — в счёте за электричество. Эти же значения использует калькулятор «Стоимость печати».</p>
    <div class="row"><button class="btn2" id="js-cancel">Отмена</button><button class="btn2 acc" id="js-save">Сохранить</button></div></div></div>`;
}
function jFormHTML(){
  const d=new Date();const iso=new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);
  return `<div class="card open"><div class="card-b" style="display:block;border:none;padding-top:6px">
    <label class="fl">Что печатал *</label><input class="f" id="jf-f" placeholder="Например, «Органайзер для отвёрток»">
    <div class="fgrid"><div><label>Дата</label><input class="f" type="date" id="jf-d" value="${iso}"></div>
      <div><label>Материал</label><select class="f" id="jf-m">${J_MATS.map(([m])=>`<option>${m}</option>`).join('')}</select></div>
      <div><label>Часов</label><input class="f" type="number" inputmode="numeric" min="0" id="jf-h" value="0"></div>
      <div><label>Минут</label><input class="f" type="number" inputmode="numeric" min="0" max="59" id="jf-mi" value="0"></div>
      <div><label>Вес, г (из слайсера)</label><input class="f" type="number" inputmode="decimal" min="0" id="jf-g" placeholder="0"></div>
      <div><label>Результат</label><select class="f" id="jf-r">${Object.entries(J_RES).map(([k,[i,l]])=>`<option value="${k}">${i} ${l}</option>`).join('')}</select></div></div>
    <label class="fl">Заметка</label><textarea id="jf-n" placeholder="Настройки, что пошло не так, что улучшить…"></textarea>
    <div class="row"><button class="btn2" id="jf-cancel">Передумал</button><button class="btn2 acc" id="jf-save">Записать</button></div></div></div>`;
}
function entryHTML(e,L,p,now){
  const i=L.indexOf(e),g=jG(e),k=jKwh(e,p),[ri,rl]=J_RES[e.res]||J_RES.ok,cost=g/1000*p.kg+k*p.kwh;
  const dt=new Date(e.at).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:now.getFullYear()===new Date(e.at).getFullYear()?undefined:'numeric'});
  return `<div class="card ${jOpen===e.id?'open':''}" data-jid="${e.id}"><div class="card-h"><div class="ico">${ri}</div><div class="t"><b>${esc(e.f)}</b>
    <span>${dt} · ${tfmt(e.dur)}${g?' · '+grams(g):''}${cost>0?' · '+money(cost,p.cur):''}${e.pr?' · '+esc(e.pr):''}</span></div><div class="chev">▸</div></div>
    <div class="card-b"><div class="fgrid">
      <div><label>Материал</label><select class="f" data-jf="mat">${J_MATS.map(([m])=>`<option ${m===e.mat?'selected':''}>${m}</option>`).join('')}</select></div>
      <div><label>Результат</label><select class="f" data-jf="res">${Object.entries(J_RES).map(([kk,[ii,l]])=>`<option value="${kk}" ${kk===e.res?'selected':''}>${ii} ${l}</option>`).join('')}</select></div>
      <div><label>Вес, г${e.mm&&(e.g==null||e.g==='')?' (по расходу)':''}</label><input class="f" type="number" inputmode="decimal" data-jf="g" value="${g||''}"></div>
      <div><label>Мощность, Вт</label><input class="f" type="number" inputmode="decimal" data-jf="w" placeholder="${p.watt} (общая)" value="${e.w!=null?e.w:''}"></div>
      <div><label>Пластик</label><input class="f" disabled value="${g&&p.kg?esc(moneyRaw(g/1000*p.kg,p.cur)):'—'}"></div>
      <div><label>Электричество</label><input class="f" disabled value="${k?esc(kwhTxt(k)+' · '+moneyRaw(k*p.kwh,p.cur)):'—'}"></div></div>
      <label class="fl">Заметка</label><textarea data-jf="note" placeholder="Что получилось, что поменять в следующий раз…">${esc(e.note||'')}</textarea>
      ${e.auto?`<p class="sub" style="margin:8px 2px 0">Записано автоматически${e.mm?`: израсходовано ${(e.mm/1000).toLocaleString('ru-RU',{maximumFractionDigits:2})} м прутка`:''}.</p>`:''}
      <div class="row"><button class="btn2 del" data-jdel="${i}" style="font-size:14px">Удалить запись</button></div></div></div>`;
}
function renderJournal(){
  const box=$('j-body');if(!box)return;
  if(jForm){box.innerHTML=jFormHTML();return}
  if(jSet){box.innerHTML=setHTML();return}
  const L=jList(),now=new Date(),p=jPrice();
  if(!L.length){box.innerHTML=`<button class="btn" id="j-add">＋ Записать печать вручную</button>`
    +emptyBox('📒','Журнал пока пуст','Когда подключённый принтер закончит печать, запись появится сама — даже если приложение закрыто, но на главном экране стоит виджет. Или добавь печать вручную — для любого принтера.')
    +`<button class="btn2 more" id="j-set">⚙️ Цены и мощность</button>`;return}
  const ks=L.map(e=>ymKey(e.at)),first=Math.min(...ks),last=Math.max(...ks,ymKey(Date.now()));
  const M=L.filter(e=>ymKey(e.at)===jYM),D=jDay?M.filter(e=>new Date(e.at).getDate()===jDay):M;
  const prevYM=jYM%100?jYM-1:jYM-89,nextYM=jYM%100===11?jYM+89:jYM+1;
  const nav=`<div class="j-nav"><button class="btn2" data-jnav="${prevYM}" ${prevYM<first?'disabled':''} aria-label="Предыдущий месяц">‹</button>
    <b>${ymName(jYM)}</b><button class="btn2" data-jnav="${nextYM}" ${nextYM>last?'disabled':''} aria-label="Следующий месяц">›</button></div>`;
  const head=nav+(M.length?statBox(jDay?`${jDay} ${J_MON_G[jYM%100]}`:'За месяц',jStats(D))+dayChart(M,jYM)
      :emptyBox('🗓️','В этом месяце печатей нет','Листай стрелками к другим месяцам.'))
    +monthTable(L)+statBox('За всё время',jStats(L));
  const F=(jFilter==='all'?D:D.filter(e=>e.res===jFilter));
  const list=F.map(e=>entryHTML(e,L,p,now)).join('');
  box.innerHTML=head+`<button class="btn" id="j-add">＋ Записать печать вручную</button>`
    +(D.length?`<div class="chips">${chips([['all','Все'],['ok','✅ Удачные'],['fail','❌ Брак'],['stop','⏹️ Остановленные']],jFilter)}</div>`:'')
    +(list||(D.length?emptyBox('🔍','Таких записей нет','Попробуй другой фильтр.'):''))
    +`<button class="btn2 more" id="j-set">⚙️ Цены и мощность: пластик ${money(p.kg,p.cur)}/кг · ${p.watt} Вт · ${money(p.kwh,p.cur)}/кВт·ч</button>`
    +`<p class="sub" style="margin-top:12px">Вес считается по длине прутка 1,75 мм и плотности материала, электричество — по средней мощности принтера и времени печати (без прогрева). Печати, закончившиеся при закрытом приложении, записывает виджет на главном экране.</p>`;
}
$('my-journal').addEventListener('click',e=>{
  const t=e.target;
  if(t.closest('#j-add')){jForm=true;renderJournal();return}
  if(t.closest('#jf-cancel')){jForm=false;renderJournal();return}
  if(t.closest('#j-set')){jSet=true;renderJournal();return}
  if(t.closest('#js-cancel')){jSet=false;renderJournal();return}
  if(t.closest('#js-save')){
    const n=id=>Math.max(0,+$(id).value||0),c=store.get('k2calc',{w:50,kg:20,h:3,watt:150,kwh:0.25,cur:'€',mat:'1.24',net:500});
    Object.assign(c,{kg:n('js-kg'),watt:n('js-w'),kwh:n('js-kwh'),cur:$('js-cur').value.trim()||'€'});store.set('k2calc',c);
    if(typeof renderTools==='function')try{renderTools()}catch(x){}
    jSet=false;renderJournal();buzz(10);toast('Сохранил цены 💾');return}
  const nv=t.closest('[data-jnav]');if(nv&&!nv.disabled){jYM=+nv.dataset.jnav;jDay=0;buzz(5);renderJournal();return}
  const mr=t.closest('[data-jym]');if(mr){jYM=+mr.dataset.jym;jDay=0;buzz(5);renderJournal();window.scrollTo({top:0,behavior:'smooth'});return}
  const dy=t.closest('[data-jday]');if(dy){const d=+dy.dataset.jday;jDay=jDay===d?0:d;buzz(5);renderJournal();return}
  if(t.closest('#jf-save')){
    const f=$('jf-f').value.trim();if(!f){shake($('jf-f'));toast('Напиши, что печатал 🙂');return}
    const d=new Date($('jf-d').value+'T12:00:00'),dur=(+$('jf-h').value||0)*3600+(+$('jf-mi').value||0)*60,g=$('jf-g').value.trim();
    const at=isFinite(d)?+d:Date.now(),L=jList();
    L.push({id:Date.now(),at,f,pr:'',dur,mm:0,g:g===''?null:Math.max(0,+g),mat:$('jf-m').value,res:$('jf-r').value,note:$('jf-n').value.trim()});
    jSave(L);jForm=false;jYM=ymKey(at);jDay=0;renderJournal();buzz(10);toast('Записал в журнал 📒');return}
  const ch=t.closest('.chip');if(ch&&ch.dataset.v){jFilter=ch.dataset.v;renderJournal();return}
  const dl=t.closest('[data-jdel]');if(dl){const i=+dl.dataset.jdel,L=jList(),[gone]=L.splice(i,1);store.set('k2journal',L);renderJournal();buzz(15);
    toast('Запись удалена',()=>{const L2=jList();L2.splice(i,0,gone);store.set('k2journal',L2);renderJournal()});return}
  const h=t.closest('[data-jid] > .card-h');if(h){const id=+h.parentElement.dataset.jid;jOpen=jOpen===id?-1:id}
});
$('my-journal').addEventListener('change',e=>{
  const f=e.target.dataset.jf;if(!f)return;const id=+e.target.closest('[data-jid]').dataset.jid,L=jList(),x=L.find(z=>z.id===id);if(!x)return;
  if(f==='g'||f==='w')x[f]=e.target.value===''?null:Math.max(0,+e.target.value);else x[f]=e.target.value;
  if(x.w==null)delete x.w;
  store.set('k2journal',L);jOpen=id;if(f!=='note')renderJournal();
});
