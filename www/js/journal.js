/* Моё → Журнал печати и статистика.
   Записи создаются сами, когда подключённый принтер заканчивает или прерывает печать (пока приложение открыто),
   и вручную — для любых принтеров. Вес считается из длины прутка 1,75 мм и плотности материала. */
const J_MATS=[['PLA',1.24],['PETG',1.27],['ABS',1.04],['ASA',1.07],['TPU',1.21],['PC',1.20],['PA (нейлон)',1.14],['Другой',1.24]];
const J_RES={ok:['✅','Удачно'],fail:['❌','Брак'],stop:['⏹️','Остановлена']};
const jList=()=>store.get('k2journal',[]);
const jDens=m=>(J_MATS.find(x=>x[0]===m)||J_MATS[0])[1];
const mmToG=(mm,m)=>mm>0?Math.PI*0.875*0.875*mm/1000*jDens(m):0; // мм³ → см³ × г/см³
const jG=e=>e.g!=null&&e.g!==''?+e.g:Math.round(mmToG(+e.mm||0,e.mat)*10)/10;
const jPrice=()=>{const c=store.get('k2calc',{kg:20,cur:'€'});return {kg:+c.kg||0,cur:c.cur||'€'}};
const moneyRaw=(v,cur)=>v.toLocaleString('ru-RU',{maximumFractionDigits:2,minimumFractionDigits:2})+' '+cur;
const money=(v,cur)=>esc(moneyRaw(v,cur));
const grams=g=>g>=1000?(g/1000).toLocaleString('ru-RU',{maximumFractionDigits:2})+' кг':Math.round(g)+' г';
let jOpen=-1,jForm=false,jFilter='all';

/* автоматическая запись (вызывается из printer.js) */
function jAuto(P,v,prevJob){
  let e=null;
  if(v.s==='done'&&v.file&&(v.elapsed||0)>60)e={f:v.file,dur:v.elapsed,mm:v.mm,res:'ok'};
  else if((v.s==='stopped'||v.s==='error')&&prevJob&&prevJob.file)e={f:prevJob.file,dur:prevJob.elapsed,mm:prevJob.mm,res:v.s==='error'?'fail':'stop'};
  if(!e)return;
  const k=`${P.host}|${e.f}|${Math.round((e.dur||0)/120)}`,L=jList();
  if(L.some(x=>x.k===k))return;
  L.unshift({id:Date.now(),k,at:Date.now(),f:e.f,pr:P.n||P.host,dur:Math.round(e.dur||0),mm:Math.round(e.mm||0),mat:'PLA',res:e.res,note:'',auto:true});
  store.set('k2journal',L.slice(0,1000));
  toast(e.res==='ok'?'Записал печать в журнал 📒':'Отметил прерванную печать в журнале');
  if(!$('my-journal').hidden)renderJournal();
}

function jStats(L){
  const {kg,cur}=jPrice();let n=0,ok=0,sec=0,g=0;
  L.forEach(e=>{n++;if(e.res==='ok')ok++;sec+=+e.dur||0;g+=jG(e)});
  return {n,ok,pct:n?Math.round(ok/n*100):0,h:sec/3600,g,cost:g/1000*kg,cur};
}
function statBox(t,s){return `<div class="card j-stat"><div class="grp-h"><b>${t}</b></div><div class="stats" style="padding:0 16px 14px">
  <div class="stat"><small>Печатей</small><b>${s.n}</b></div><div class="stat"><small>Удачных</small><b>${s.n?s.pct+' %':'—'}</b></div><div class="stat"><small>Часов</small><b>${s.h.toLocaleString('ru-RU',{maximumFractionDigits:1})}</b></div>
  <div class="stat"><small>Пластика</small><b>${grams(s.g)}</b></div><div class="stat" style="grid-column:span 2"><small>Стоимость пластика</small><b>${money(s.cost,s.cur)}</b></div></div></div>`}
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
function renderJournal(){
  const box=$('j-body');if(!box)return;
  if(jForm){box.innerHTML=jFormHTML();return}
  const L=jList(),now=new Date(),mon=L.filter(e=>{const d=new Date(e.at);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()});
  const F=jFilter==='all'?L:L.filter(e=>e.res===jFilter);
  const head=!L.length?'':mon.length===L.length?statBox('Этот месяц',jStats(mon)):statBox('Этот месяц',jStats(mon))+statBox('За всё время',jStats(L));
  const {kg,cur}=jPrice();
  const list=F.map(e=>{const i=L.indexOf(e),g=jG(e),[ri,rl]=J_RES[e.res]||J_RES.ok;
    const dt=new Date(e.at).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:now.getFullYear()===new Date(e.at).getFullYear()?undefined:'numeric'});
    return `<div class="card ${jOpen===e.id?'open':''}" data-jid="${e.id}"><div class="card-h"><div class="ico">${ri}</div><div class="t"><b>${esc(e.f)}</b>
      <span>${dt} · ${tfmt(e.dur)}${g?' · '+grams(g):''}${e.pr?' · '+esc(e.pr):''}</span></div><div class="chev">▸</div></div>
      <div class="card-b"><div class="fgrid">
        <div><label>Материал</label><select class="f" data-jf="mat">${J_MATS.map(([m])=>`<option ${m===e.mat?'selected':''}>${m}</option>`).join('')}</select></div>
        <div><label>Результат</label><select class="f" data-jf="res">${Object.entries(J_RES).map(([k,[ii,l]])=>`<option value="${k}" ${k===e.res?'selected':''}>${ii} ${l}</option>`).join('')}</select></div>
        <div><label>Вес, г${e.mm&&(e.g==null||e.g==='')?' (по расходу)':''}</label><input class="f" type="number" inputmode="decimal" data-jf="g" value="${g||''}"></div>
        <div><label>Стоимость</label><input class="f" disabled value="${g&&kg?esc(moneyRaw(g/1000*kg,cur)):'—'}"></div></div>
        <label class="fl">Заметка</label><textarea data-jf="note" placeholder="Что получилось, что поменять в следующий раз…">${esc(e.note||'')}</textarea>
        ${e.auto?`<p class="sub" style="margin:8px 2px 0">Записано автоматически${e.mm?`: израсходовано ${(e.mm/1000).toLocaleString('ru-RU',{maximumFractionDigits:2})} м прутка`:''}.</p>`:''}
        <div class="row"><button class="btn2 del" data-jdel="${i}" style="font-size:14px">Удалить запись</button></div></div></div>`}).join('');
  box.innerHTML=head+`<button class="btn" id="j-add">＋ Записать печать вручную</button>`
    +(L.length?`<div class="chips">${chips([['all','Все'],['ok','✅ Удачные'],['fail','❌ Брак'],['stop','⏹️ Остановленные']],jFilter)}</div>`:'')
    +(list||(L.length?emptyBox('🔍','Таких записей нет','Попробуй другой фильтр.'):emptyBox('📒','Журнал пока пуст','Когда подключённый принтер закончит печать, запись появится сама. Или добавь печать вручную — для любого принтера.')))
    +`<p class="sub" style="margin-top:12px">Вес считается по длине прутка 1,75 мм и плотности материала, цена — из калькулятора «Стоимость печати» в Справочнике → Инструменты.</p>`;
}
$('my-journal').addEventListener('click',e=>{
  const t=e.target;
  if(t.closest('#j-add')){jForm=true;renderJournal();return}
  if(t.closest('#jf-cancel')){jForm=false;renderJournal();return}
  if(t.closest('#jf-save')){
    const f=$('jf-f').value.trim();if(!f){shake($('jf-f'));toast('Напиши, что печатал 🙂');return}
    const d=new Date($('jf-d').value+'T12:00:00'),dur=(+$('jf-h').value||0)*3600+(+$('jf-mi').value||0)*60,g=$('jf-g').value.trim();
    const L=jList();L.unshift({id:Date.now(),at:isFinite(d)?+d:Date.now(),f,pr:'',dur,mm:0,g:g===''?null:Math.max(0,+g),mat:$('jf-m').value,res:$('jf-r').value,note:$('jf-n').value.trim()});
    L.sort((a,b)=>b.at-a.at);store.set('k2journal',L);jForm=false;renderJournal();buzz(10);toast('Записал в журнал 📒');return}
  const ch=t.closest('.chip');if(ch&&ch.dataset.v){jFilter=ch.dataset.v;renderJournal();return}
  const dl=t.closest('[data-jdel]');if(dl){const i=+dl.dataset.jdel,L=jList(),[gone]=L.splice(i,1);store.set('k2journal',L);renderJournal();buzz(15);
    toast('Запись удалена',()=>{const L2=jList();L2.splice(i,0,gone);store.set('k2journal',L2);renderJournal()});return}
  const h=t.closest('[data-jid] > .card-h');if(h){const id=+h.parentElement.dataset.jid;jOpen=jOpen===id?-1:id}
});
$('my-journal').addEventListener('change',e=>{
  const f=e.target.dataset.jf;if(!f)return;const id=+e.target.closest('[data-jid]').dataset.jid,L=jList(),x=L.find(z=>z.id===id);if(!x)return;
  if(f==='g')x.g=e.target.value===''?null:Math.max(0,+e.target.value);else x[f]=e.target.value;
  store.set('k2journal',L);jOpen=id;if(f!=='note')renderJournal();
});
