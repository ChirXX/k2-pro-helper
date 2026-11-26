/* 3D Помощник — логика интерфейса */
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
const today=()=>new Date().toLocaleDateString('ru-RU');
const li=a=>a.map(x=>`<li>${x}</li>`).join('');
const card=(i,t,s,body)=>`<div class="card"><div class="card-h"><div class="ico">${i}</div><div class="t"><b>${t}</b><span>${s||''}</span></div><div class="chev">▸</div></div><div class="card-b">${body}</div></div>`;
const chips=(list,cur,attr='v')=>list.map(([v,l])=>`<button class="chip ${v===cur?'on':''}" data-${attr}="${esc(v)}">${l}</button>`).join('');
const link=site=>`<a href="https://${site}" target="_blank" rel="noopener">${site}</a>`;
/* --- живая обратная связь: вибро, тост с «Вернуть», конфетти, тряска поля --- */
const buzz=ms=>{try{navigator.vibrate&&navigator.vibrate(ms)}catch(e){}};
let toastT;
function hideToast(){$('toast').classList.remove('show')}
function toast(msg,undo){
  const t=$('toast'),b=t.querySelector('button');
  t.querySelector('span').textContent=msg;
  b.hidden=!undo;b.textContent='Вернуть';
  b.onclick=()=>{hideToast();if(undo){undo();buzz(8)}};
  t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(hideToast,undo?5000:2600);
}
function shake(el){el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');setTimeout(()=>el.classList.remove('shake'),450);el.focus()}
function confetti(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const cols=['#FF8F52','#62DCA0','#8CC8FF','#FFC766','#F4EFE9'];
  for(let i=0;i<36;i++){const c=document.createElement('i');c.className='confetti';
    c.style.left=Math.random()*100+'vw';c.style.background=cols[i%cols.length];
    c.style.animationDuration=(1.6+Math.random()*1.4)+'s';c.style.animationDelay=Math.random()*.3+'s';
    document.body.appendChild(c);setTimeout(()=>c.remove(),3600)}
}
const emptyBox=(ico,title,text,btn)=>`<div class="empty"><span class="e-ico">${ico}</span><b>${title}</b>${text}${btn?'<br>'+btn:''}</div>`;

/* приветствие по времени суток */
(function(){const h=new Date().getHours();
  const g=h<5||h>=23?'Доброй ночи':h<12?'Доброе утро':h<18?'Добрый день':'Добрый вечер';
  $('greet').textContent=g+'! '+(h<5||h>=23?'Принтер тоже не спит?':'Что печатаем сегодня?');
})();

/* ================= ПРОБЛЕМЫ ================= */
// Поиск видео по проблеме: русский запрос, английский запрос, Rutube
function videoLinks(p){
  const ru=(p.t.replace(/[«»"]/g,'')+(p.b?' '+BRANDS[p.b]:'')+' 3д печать').trim();
  const en=(window.PROBLEM_EN&&PROBLEM_EN[p.t])||ru;
  const u=encodeURIComponent;
  return `<div class="lbl">Видео по теме</div><div class="vlinks">
    <a href="https://www.youtube.com/results?search_query=${u(ru)}" target="_blank" rel="noopener">▶ YouTube RU</a>
    <a href="https://www.youtube.com/results?search_query=${u(en)}" target="_blank" rel="noopener">▶ YouTube EN</a>
    <a href="https://rutube.ru/search/?query=${u(ru)}" target="_blank" rel="noopener">▶ Rutube</a></div>`;
}
let pcat='Все',pbrand=store.get('k2brand','all');
if(pbrand!=='all'&&!BRANDS[pbrand])pbrand='all';
function renderPChips(){
  $('pcats').innerHTML=chips(["Все",...new Set(PROBLEMS.map(p=>p.c))].map(c=>[c,c]),pcat);
  $('pbrands').innerHTML=chips([['all','Любой'],...Object.entries(BRANDS)],pbrand);
}
function renderP(){
  const q=$('q').value.trim().toLowerCase();
  const L=PROBLEMS.filter(p=>(pcat==="Все"||p.c===pcat)&&(pbrand==='all'||!p.b||p.b===pbrand)&&
    (!q||[p.t,p.s,p.k,p.b?BRANDS[p.b]:'',...p.why,...p.fix].join(' ').toLowerCase().includes(q)));
  // сначала проблемы выбранной марки
  if(pbrand!=='all')L.sort((a,b)=>(b.b===pbrand)-(a.b===pbrand));
  $('plist').innerHTML=L.length?L.map(p=>card(p.i,p.t,(p.b?`<i class="tag">${BRANDS[p.b]}</i>`:'')+p.s,
    `<div class="lbl">Почему</div><ul>${li(p.why)}</ul><div class="lbl">Что сделать</div><ol>${li(p.fix)}</ol>${p.tip?`<div class="tip">💡 ${p.tip}</div>`:''}${videoLinks(p)}`)).join('')
    :emptyBox('🔍','Хм, такого пока нет','Попробуй сказать проще — «липнет», «полосы», «щёлкает» — или сбрось фильтры.','<button class="btn2" data-preset>Сбросить фильтры</button>');
}
$('plist').addEventListener('click',e=>{if(!e.target.closest('[data-preset]'))return;
  pcat='Все';pbrand='all';store.set('k2brand','all');$('q').value='';renderPChips();renderP()});
/* совет дня — берём подсказки из карточек проблем, меняется каждый день */
const TIPS=PROBLEMS.filter(p=>p.tip);
let tipI=Math.floor(Date.now()/864e5)%TIPS.length;
function renderTip(anim){const p=TIPS[tipI];
  $('daytip').innerHTML=`<div class="dt-h"><b>💡 Совет дня</b><button id="tipnext">Ещё ↻</button></div><p class="${anim?'swap':''}">${p.tip}</p><small>Из темы «<a href="#" data-tipgo>${p.t}</a>»</small>`}
$('daytip').onclick=e=>{
  if(e.target.closest('#tipnext')){tipI=(tipI+1)%TIPS.length;renderTip(true);buzz(5);return}
  if(!e.target.closest('[data-tipgo]'))return;e.preventDefault();
  const p=TIPS[tipI];pcat='Все';if(p.b&&pbrand!=='all'&&pbrand!==p.b)pbrand='all';
  $('q').value=p.t;renderPChips();renderP();
  const c=$('plist').querySelector('.card');if(c){c.classList.add('open');c.scrollIntoView({behavior:'smooth',block:'center'})}
};
$('pcats').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;pcat=b.dataset.v;renderPChips();renderP()};
$('pbrands').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;pbrand=b.dataset.v;store.set('k2brand',pbrand);renderPChips();renderP()};
$('q').oninput=renderP;

/* ================= ПРИНТЕРЫ ================= */
let prb='all';
function renderPr(){
  const used=[...new Set(PRINTERS.map(p=>p.b))];
  $('prbrands').innerHTML=chips([['all','Все'],...used.map(b=>[b,BRANDS[b]])],prb);
  $('prlist').innerHTML=PRINTERS.filter(p=>prb==='all'||p.b===prb).map(p=>{
    const cnt=PROBLEMS.filter(x=>x.b===p.b).length;
    const body=`<div class="spec">${p.spec.map(([k,v])=>`<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      <div class="lbl">Мультицвет</div><p style="margin:0;font-size:15px">${p.multi}</p>
      <div class="lbl">Особенности</div><ul>${li(p.feat)}</ul>
      <div class="lbl">Советы</div><ul>${li(p.tips)}</ul>
      ${p.guides?`<div class="lbl">Подробно</div>${p.guides.map(g=>card(g.i,g.t,g.s,g.b)).join('')}`:''}
      <div class="row">${cnt?`<button class="btn2 acc" data-gob="${p.b}">Типичные проблемы (${cnt}) →</button>`:''}<a class="btn2" href="https://${p.site}" target="_blank" rel="noopener">🌐 ${p.site}</a></div>`;
    return card('🖨️',p.n,`${BRANDS[p.b]} · ${p.type}`,body);
  }).join('');
}
$('prbrands').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;prb=b.dataset.v;renderPr()};
$('prlist').addEventListener('click',e=>{const b=e.target.closest('[data-gob]');if(!b)return;
  pbrand=b.dataset.gob;store.set('k2brand',pbrand);pcat='Все';$('q').value='';renderPChips();renderP();go('s-problems')});

/* ================= МАТЕРИАЛЫ ================= */
let mg='Все';
function renderMat(){
  $('mgroups').innerHTML=chips(["Все",...new Set(MATERIALS.map(m=>m.g))].map(g=>[g,g]),mg);
  $('matlist').innerHTML=MATERIALS.filter(m=>mg==='Все'||m.g===mg).map(f=>`
  <div class="card"><div class="fil-top"><div class="fil-name"><b>${f.n}</b><span class="badge ${f.d[1]}">${f.d[0]}</span></div>
  <div class="stats"><div class="stat"><small>Сопло</small><b>${f.noz}</b></div><div class="stat"><small>Стол</small><b>${f.bed}</b></div><div class="stat"><small>Камера</small><b>${f.cham}</b></div></div>
  <div class="stats" style="margin-top:8px"><div class="stat"><small>Обдув</small><b>${f.fan}</b></div><div class="stat"><small>Сушка</small><b>${f.dry.replace(" · ","<br>")}</b></div><div class="stat"><small>CFS / AMS</small><b>${f.multi}</b></div></div></div>
  <ul class="fil-notes">${li(f.notes)}</ul></div>`).join('');
}
$('mgroups').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;mg=b.dataset.v;renderMat()};

/* --- производители и свои поставщики --- */
const stars=r=>r?`<span class="stars">${'★'.repeat(r)}${'☆'.repeat(5-r)}</span>`:'—';
function supLink(s){
  s=String(s||'').trim();if(!s)return '';
  const u=/^https?:\/\//i.test(s)?s:(/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)?'https://'+s:'');
  return u&&/^https?:\/\/[^\s"'<>]+$/i.test(u)?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(s)}</a>`:esc(s);
}
function renderBrands(){
  const q=$('bq').value.trim().toLowerCase();
  const m=o=>!q||Object.values(o).join(' ').toLowerCase().includes(q);
  const S=store.get('k2suppliers',[]);
  const mine=S.map((s,i)=>({s,i})).filter(x=>m(x.s));
  $('suplist').innerHTML=mine.length?`<div class="chips-lbl">Мои поставщики</div>`+mine.map(({s,i})=>`
    <div class="card"><div class="card-h"><div class="ico">🏪</div><div class="t"><b>${esc(s.n)}<i class="mine">моё</i></b><span>${esc(s.mat||'')}${s.r?' · '+'★'.repeat(s.r):''}</span></div><div class="chev">▸</div></div>
    <div class="card-b"><div class="kv">
      ${s.site?`<div><span>Контакт</span><b>${supLink(s.site)}</b></div>`:''}
      ${s.mat?`<div><span>Материалы</span>${esc(s.mat)}</div>`:''}
      ${s.price?`<div><span>Цена</span>${esc(s.price)}</div>`:''}
      <div><span>Оценка</span>${stars(+s.r||0)}</div>
      ${s.note?`<div><span>Заметка</span><span style="width:auto;color:var(--text);white-space:pre-wrap">${esc(s.note)}</span></div>`:''}
      <div><span>Добавлен</span>${esc(s.d||'')}</div>
    </div><div class="row"><button class="btn2" data-edit="${i}">✏️ Изменить</button><button class="btn2 del" data-del="${i}" style="font-size:14px">Удалить</button></div></div></div>`).join('')
    +`<div class="chips-lbl" style="margin-top:14px">Популярные марки</div>`:'';
  const B=FIL_BRANDS.filter(m);
  $('brandlist').innerHTML=B.map(b=>card('🧵',b.n,`${b.c} · ${b.lines}`,`<div class="kv">
      <div><span>Страна</span>${b.c}</div><div><span>Линейки</span>${b.lines}</div><div><span>Катушка</span>${b.spool}</div><div><span>Сайт</span>${link(b.site)}</div></div>
      <div class="tip">💡 ${b.notes}</div>`)).join('')+(B.length||mine.length?`<div class="warn">⚠️ Линейки и катушки меняются — проверяй на сайте производителя. Картонные катушки в CFS/AMS используй с переходными кольцами.</div>`:emptyBox('🧵','Ничего не нашлось','Попробуй другое название, материал или страну.'));
}
let editIdx=-1;
const SF=['n','site','mat','price','r','note'];
function openForm(i){
  editIdx=i;const s=i>=0?store.get('k2suppliers',[])[i]||{}:{};
  SF.forEach(k=>$('sf-'+k).value=s[k]!=null?s[k]:(k==='r'?'0':''));
  $('sup-form').hidden=false;$('sup-toggle').hidden=true;$('sf-save').textContent=i>=0?'Сохранить изменения':'Сохранить';
  $('sup-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeForm(){$('sup-form').hidden=true;$('sup-toggle').hidden=false;editIdx=-1}
$('sup-toggle').onclick=()=>openForm(-1);
$('sf-cancel').onclick=closeForm;
$('sf-save').onclick=()=>{
  const o={};SF.forEach(k=>o[k]=$('sf-'+k).value.trim());o.r=+o.r||0;
  if(!o.n){shake($('sf-n'));toast('Как называется магазин? Без названия не сохраню 🙂');return}
  const S=store.get('k2suppliers',[]),was=editIdx>=0&&S[editIdx];
  if(was){o.d=S[editIdx].d;S[editIdx]=o}else{o.d=today();S.unshift(o)}
  store.set('k2suppliers',S);closeForm();renderBrands();buzz(10);
  toast(was?'Изменения сохранены ✓':`«${o.n}» теперь в твоём списке ✓`);
};
$('suplist').addEventListener('click',e=>{
  const ed=e.target.closest('[data-edit]');if(ed){openForm(+ed.dataset.edit);return}
  const d=e.target.closest('[data-del]');if(!d)return;
  const i=+d.dataset.del,S=store.get('k2suppliers',[]),[gone]=S.splice(i,1);
  store.set('k2suppliers',S);renderBrands();buzz(15);
  toast(`«${gone.n}» удалён`,()=>{const S2=store.get('k2suppliers',[]);S2.splice(i,0,gone);store.set('k2suppliers',S2);renderBrands()});
});
$('bq').oninput=renderBrands;
$('mseg').onclick=e=>{const b=e.target.closest('button');if(!b)return;
  [...$('mseg').children].forEach(x=>x.classList.toggle('on',x===b));
  $('m-mat').hidden=b.dataset.v!=='mat';$('m-brands').hidden=b.dataset.v!=='brands'};

/* ================= СПРАВОЧНИК ================= */
let gs=GUIDE[0].sec;
function toolsHTML(){
  const c=store.get('k2calc',{w:50,kg:20,h:3,watt:150,kwh:0.25,cur:'€',mat:'1.24',net:500});
  return card('🧮','Стоимость печати','пластик + электричество',`
   <div class="fgrid">
    <div><label>Вес модели, г</label><input class="f" type="number" inputmode="decimal" id="c-w" value="${c.w}"></div>
    <div><label>Цена катушки за 1 кг</label><input class="f" type="number" inputmode="decimal" id="c-kg" value="${c.kg}"></div>
    <div><label>Время печати, ч</label><input class="f" type="number" inputmode="decimal" id="c-h" value="${c.h}"></div>
    <div><label>Мощность в среднем, Вт</label><input class="f" type="number" inputmode="decimal" id="c-watt" value="${c.watt}"></div>
    <div><label>Цена за кВт·ч</label><input class="f" type="number" inputmode="decimal" id="c-kwh" value="${c.kwh}"></div>
    <div><label>Валюта</label><input class="f" id="c-cur" value="${esc(c.cur)}"></div>
   </div><div class="res" id="c-res"></div>
   <div class="tip">💡 Вес и время показывает слайсер после нарезки. Средняя мощность большинства принтеров при печати PLA — 100–200 Вт, с горячей камерой больше.</div>`)
  +card('📏','Сколько осталось на катушке','метры по весу (пруток 1,75 мм)',`
   <div class="fgrid">
    <div><label>Материал</label><select class="f" id="c-mat">${[['1.24','PLA'],['1.27','PETG'],['1.04','ABS'],['1.07','ASA'],['1.20','PC'],['1.14','PA (нейлон)'],['1.21','TPU']].map(([v,l])=>`<option value="${v}" ${v===String(c.mat)?'selected':''}>${l}</option>`).join('')}</select></div>
    <div><label>Вес пластика, г</label><input class="f" type="number" inputmode="decimal" id="c-net" value="${c.net}"></div>
   </div><div class="res" id="c-res2"></div>
   <div class="tip">💡 Взвесь катушку на кухонных весах и вычти вес пустой катушки (часто 150–250 г, пишут на сайте производителя).</div>`)
  +card('🔄','Пересчёт ширины линии и расхода','сколько мм³/с ты просишь у хотэнда',`
   <div class="fgrid">
    <div><label>Скорость, мм/с</label><input class="f" type="number" inputmode="decimal" id="c-sp" value="${c.sp||200}"></div>
    <div><label>Высота слоя, мм</label><input class="f" type="number" inputmode="decimal" id="c-lh" value="${c.lh||0.2}"></div>
    <div><label>Ширина линии, мм</label><input class="f" type="number" inputmode="decimal" id="c-lw" value="${c.lw||0.42}"></div>
   </div><div class="res" id="c-res3"></div>`);
}
function calc(){
  const n=id=>{const v=parseFloat(String($(id).value).replace(',','.'));return isFinite(v)&&v>=0?v:0};
  const c={w:n('c-w'),kg:n('c-kg'),h:n('c-h'),watt:n('c-watt'),kwh:n('c-kwh'),cur:$('c-cur').value.trim()||'€',mat:$('c-mat').value,net:n('c-net'),sp:n('c-sp'),lh:n('c-lh'),lw:n('c-lw')};
  store.set('k2calc',c);
  const f=x=>x.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+esc(c.cur);
  const mat=c.w/1000*c.kg,el=c.watt/1000*c.h*c.kwh;
  $('c-res').innerHTML=`<div><span>Пластик</span><b>${f(mat)}</b></div><div><span>Электричество</span><b>${f(el)}</b></div><div class="tot"><span>Итого</span><span>${f(mat+el)}</span></div>`;
  const gpm=Math.PI*0.0875*0.0875*100*parseFloat(c.mat); // г на метр
  $('c-res2').innerHTML=`<div class="tot" style="border:none;margin:0;padding:0"><span>Осталось</span><span>≈ ${Math.round(c.net/gpm)} м</span></div><div><span>1 метр весит</span><b>${gpm.toFixed(2).replace('.',',')} г</b></div>`;
  const mvs=c.sp*c.lh*c.lw;
  $('c-res3').innerHTML=`<div class="tot" style="border:none;margin:0;padding:0"><span>Расход</span><span>${mvs.toFixed(1).replace('.',',')} мм³/с</span></div><div style="color:var(--muted);font-size:13px"><span>${mvs>25?'Много для большинства хотэндов — возможна недоэкструзия':mvs>15?'Нужен «скоростной» пластик и хороший хотэнд':'Обычно комфортно для PLA'}</span></div>`;
}
function renderG(){
  const q=$('gq').value.trim().toLowerCase();
  $('gsecs').innerHTML=chips(GUIDE.map(s=>[s.sec,s.sec]),q?'':gs);
  if(q){
    const hits=[];GUIDE.forEach(s=>s.items.forEach(a=>{if((a.t+' '+a.s+' '+a.b.replace(/<[^>]+>/g,' ')).toLowerCase().includes(q))hits.push({a,sec:s.sec})}));
    $('glist').innerHTML=hits.length?hits.map(({a,sec})=>card(a.i,a.t,`${sec} · ${a.s}`,a.b)).join(''):emptyBox('📚','Об этом я пока не писал','Попробуй другое слово — например, «ретракт», «калибровка» или «сушка».');
    return;
  }
  const S=GUIDE.find(s=>s.sec===gs)||GUIDE[0];
  if(S.tools){$('glist').innerHTML=toolsHTML();document.querySelectorAll('#glist .card').forEach(c=>c.classList.add('open'));calc();return}
  $('glist').innerHTML=S.items.map(a=>card(a.i,a.t,a.s,a.b)).join('');
}
$('gsecs').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;gs=b.dataset.v;$('gq').value='';renderG()};
$('gq').oninput=renderG;
$('glist').addEventListener('input',e=>{if(e.target.id&&e.target.id.startsWith('c-'))calc()});
$('glist').addEventListener('change',e=>{if(e.target.id==='c-mat')calc()});

/* ================= ВИДЕО ================= */
// RSS-ленты YouTube. На телефоне запросы идут через CapacitorHttp (обходит CORS).
const VC_TTL=6*3600e3; // обновлять не чаще раза в 6 часов, если не нажали «Обновить»
let vfeed='fun',vlang='all',vch='all',vbusy=false;
const allChannels=()=>[...CHANNELS,...store.get('k2channels',[]).map(c=>({...c,mine:true}))];
const feedChannels=()=>allChannels().filter(c=>c.f===vfeed&&(vlang==='all'||c.l===vlang));
function parseRSS(xml){
  const d=new DOMParser().parseFromString(xml,'application/xml');
  if(d.getElementsByTagName('parsererror').length)throw new Error('bad xml');
  return [...d.getElementsByTagName('entry')].map(e=>({
    v:(e.getElementsByTagName('yt:videoId')[0]||{}).textContent,
    t:(e.getElementsByTagName('title')[0]||{}).textContent||'',
    d:(e.getElementsByTagName('published')[0]||{}).textContent||''
  })).filter(x=>/^[\w-]{11}$/.test(x.v||'')).slice(0,15);
}
async function fetchText(url){
  const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),15000);
  try{const r=await fetch(url,{signal:ctl.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.text()}
  finally{clearTimeout(tm)}
}
async function loadFeeds(force){
  if(vbusy)return;vbusy=true;$('vstatus').textContent='Собираю свежие ролики…';$('vstatus').classList.add('busy');
  const cache=store.get('k2vcache',{}),now=Date.now();
  const need=feedChannels().filter(c=>force||!cache[c.id]||now-cache[c.id].at>VC_TTL);
  let ok=0,fail=0;
  await Promise.all(need.map(async c=>{
    try{cache[c.id]={at:Date.now(),items:parseRSS(await fetchText('https://www.youtube.com/feeds/videos.xml?channel_id='+c.id))};ok++}
    catch(e){fail++}
  }));
  // чистим кэш удалённых каналов
  const ids=new Set(allChannels().map(c=>c.id));Object.keys(cache).forEach(k=>{if(!ids.has(k))delete cache[k]});
  store.set('k2vcache',cache);vbusy=false;
  renderV(need.length&&fail===need.length?'Интернета нет — показываю то, что уже скачано':fail?`Обновил. Не ответили каналов: ${fail} — попробуй позже`:'');
}
function ago(iso){
  const t=Date.parse(iso);if(!t)return '';const d=Math.floor((Date.now()-t)/864e5);
  if(d<1)return 'сегодня';if(d<2)return 'вчера';if(d<7)return d+' дн. назад';if(d<35)return Math.floor(d/7)+' нед. назад';
  return new Date(t).toLocaleDateString('ru-RU');
}
function renderV(msg){
  $('vlang').innerHTML=chips([['all','Все языки'],['ru','Русский'],['en','English']],vlang);
  const chs=feedChannels();if(vch!=='all'&&!chs.some(c=>c.id===vch))vch='all';
  $('vchans').innerHTML=chips([['all','Все каналы'],...chs.map(c=>[c.id,esc(c.n)])],vch);
  const cache=store.get('k2vcache',{});
  // в общей ленте — не больше 3 свежих роликов с канала, чтобы частые каналы не вытесняли остальных
  const per=vch==='all'?3:15;
  const items=[];chs.filter(c=>vch==='all'||c.id===vch).forEach(c=>((cache[c.id]||{}).items||[]).slice().sort((a,b)=>Date.parse(b.d)-Date.parse(a.d)).slice(0,per).forEach(it=>items.push({...it,c})));
  items.sort((a,b)=>Date.parse(b.d)-Date.parse(a.d));
  const times=chs.map(c=>(cache[c.id]||{}).at).filter(Boolean);
  $('vstatus').classList.toggle('busy',vbusy);
  $('vstatus').textContent=msg||(times.length?'Обновлено '+new Date(Math.min(...times)).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'');
  $('vlist').innerHTML=items.length?items.slice(0,60).map(it=>`<a class="vid" href="https://www.youtube.com/watch?v=${it.v}" target="_blank" rel="noopener">
    <div class="th"><img loading="lazy" alt="" src="https://i.ytimg.com/vi/${it.v}/mqdefault.jpg" onerror="this.remove()"></div>
    <div class="vt"><b>${esc(it.t)}</b><span>${esc(it.c.n)} · ${ago(it.d)}</span></div></a>`).join('')
    :(vbusy?emptyBox('🎬','Собираю ролики…','Секунду, спрашиваю у YouTube.'):emptyBox('📡','Тут пока пусто','Подключись к интернету и нажми «↻ Обновить» — подтяну свежие ролики.'));
  renderVC();
}
function renderVC(){
  const M=store.get('k2channels',[]);
  $('vc-list').innerHTML=M.length?`<div class="lbl">Добавленные</div>`+M.map((c,i)=>`<div class="chline"><span>${esc(c.n)} <small style="color:var(--muted)">· ${c.f==='fun'?'модели':'проблемы'}</small></span><button class="del" data-vdel="${i}" aria-label="Удалить">×</button></div>`).join(''):'';
}
async function resolveChannel(raw){
  raw=raw.trim();
  let m=raw.match(/(UC[\w-]{22})/);if(m)return m[1];
  let url='';
  const yt=raw.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(@[\w.\-]+|c\/[\w.\-]+|user\/[\w.\-]+)/i);
  if(/^@[\w.\-]+$/.test(raw))url='https://www.youtube.com/'+raw;
  else if(yt)url='https://www.youtube.com/'+yt[1];
  else if(/^[\w.\-]{3,}$/.test(raw))url='https://www.youtube.com/@'+raw;
  if(!url)throw new Error('Не похоже на ссылку на канал. Пример: youtube.com/@CNCKitchen');
  const html=await fetchText(url.replace(/^http:/,'https:'));
  m=html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)||html.match(/"externalId":"(UC[\w-]{22})"/)||html.match(/"channelId":"(UC[\w-]{22})"/);
  if(!m)throw new Error('Не нашёл такой канал — проверь, нет ли опечатки');
  return m[1];
}
$('vc-add').onclick=async()=>{
  const raw=$('vc-in').value,msg=$('vc-msg');if(!raw.trim()){shake($('vc-in'));return}
  msg.textContent='Ищу канал на YouTube…';$('vc-add').disabled=true;
  try{
    const id=await resolveChannel(raw);
    if(allChannels().some(c=>c.id===id))throw new Error('Этот канал уже есть в ленте 👍');
    const xml=await fetchText('https://www.youtube.com/feeds/videos.xml?channel_id='+id);
    const d=new DOMParser().parseFromString(xml,'application/xml');
    const n=((d.getElementsByTagName('title')[0]||{}).textContent||id).trim();
    const items=parseRSS(xml);
    const ru=/[а-яё]/i.test(n+' '+items.map(x=>x.t).join(' '));
    const M=store.get('k2channels',[]);M.push({id,n,f:$('vc-feed').value,l:ru?'ru':'en'});store.set('k2channels',M);
    const cache=store.get('k2vcache',{});cache[id]={at:Date.now(),items};store.set('k2vcache',cache);
    msg.textContent=`Готово! «${n}» теперь в ленте 🎉`;$('vc-in').value='';buzz(10);
    if($('vc-feed').value!==vfeed){vfeed=$('vc-feed').value;[...$('vseg').children].forEach(x=>x.classList.toggle('on',x.dataset.v===vfeed))}
    vlang='all';vch=id;renderV();
  }catch(e){msg.textContent=(e.name==='AbortError'?'YouTube долго не отвечает — проверь интернет и попробуй ещё раз':e.message==='Failed to fetch'?'Нет связи с YouTube — проверь интернет':e.message)}
  finally{$('vc-add').disabled=false}
};
$('vc-list').onclick=e=>{const d=e.target.closest('[data-vdel]');if(!d)return;
  const i=+d.dataset.vdel,M=store.get('k2channels',[]),[gone]=M.splice(i,1);store.set('k2channels',M);renderV();buzz(15);
  toast(`«${gone.n}» убран из ленты`,()=>{const M2=store.get('k2channels',[]);M2.splice(i,0,gone);store.set('k2channels',M2);renderV()})};
$('vseg').onclick=e=>{const b=e.target.closest('button');if(!b)return;vfeed=b.dataset.v;vch='all';
  [...$('vseg').children].forEach(x=>x.classList.toggle('on',x===b));renderV();loadFeeds(false)};
$('vlang').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;vlang=b.dataset.v;renderV();loadFeeds(false)};
$('vchans').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;vch=b.dataset.v;renderV()};
$('vrefresh').onclick=()=>loadFeeds(true);
let vStarted=false;

/* ================= УХОД ================= */
// Порядок пунктов не менять: отметки хранятся по номеру пункта (ключ k2care)
const M=[
{g:"Перед каждой печатью",id:"each",items:[["Пластина чистая, без следов пальцев",""],["Нет пластика на кончике сопла",""],["Катушка свободно крутится, пруток не перехлестнут",""],["Лоток для отходов пустой",""]]},
{g:"Раз в неделю",id:"week",items:[["Помыть PEI-пластину водой со средством",""],["Убрать отходы и крошки со дна камеры",""],["Проверить влажность в CFS / сухом боксе","Осушитель или силикагель — просушить при необходимости"]]},
{g:"Раз в месяц",id:"month",items:[["Протереть направляющие и рельсы сухой безворсовой салфеткой","Смазку — только по инструкции производителя"],["Проверить натяжение ремней","Звучат одинаково на обеих сторонах"],["Почистить латунной щёткой сопло и датчик",""],["Протереть объективы камер",""],["Проверить обновления прошивки",""]]},
{g:"Раз в 3–6 месяцев",id:"q",items:[["Смазать ходовые винты Z","Тонким слоем, по инструкции производителя"],["Проверить или заменить угольный фильтр","Особенно если печатаешь ABS/ASA"],["Осмотреть сопло, при износе заменить",""],["Продуть вентиляторы от пыли",""],["Откалибровать резонансы (input shaping)","После переезда или замены ремней — обязательно"]]}
];
const grpDone=(g,st)=>g.items.filter((_,i)=>st[g.id+i]).length;
function renderM(popK){
  const st=store.get('k2care',{});
  $('mlist').innerHTML=M.map(g=>{
    const done=grpDone(g,st),n=g.items.length,pct=Math.round(done/n*100);
    return `<div class="card ${done===n?'full':''}"><div class="grp-h"><b>${g.g}<em>${done===n?'всё сделано 🧡':done+' из '+n}</em></b>${done?`<button class="reset" data-g="${g.id}">Сбросить</button>`:''}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    ${g.items.map((it,i)=>`<div class="check ${st[g.id+i]?'done':''} ${popK===g.id+i?'pop':''}" data-k="${g.id+i}"><div class="box"></div><div class="ct"><span>${it[0]}</span>${it[1]?`<small>${it[1]}</small>`:''}${st[g.id+i]?`<small class="when">✓ сделано ${esc(st[g.id+i])}</small>`:''}</div></div>`).join('')}</div>`}).join('');
}
$('mlist').onclick=e=>{
  const st=store.get('k2care',{});
  const r=e.target.closest('.reset');
  if(r){const snap={...st};Object.keys(st).forEach(k=>{if(k.startsWith(r.dataset.g))delete st[k]});store.set('k2care',st);renderM();
    toast('Отметки сброшены',()=>{store.set('k2care',snap);renderM()});return}
  const c=e.target.closest('.check');if(!c)return;
  const k=c.dataset.k;if(st[k])delete st[k];else st[k]=today();
  store.set('k2care',st);renderM(st[k]?k:'');buzz(st[k]?12:6);
  const g=M.find(g=>k.startsWith(g.id)&&/^\d+$/.test(k.slice(g.id.length)));
  if(st[k]&&g&&grpDone(g,st)===g.items.length){confetti();buzz([20,60,20]);toast('Всё сделано! Принтер скажет спасибо 🧡')}
};

/* ================= ЗАМЕТКИ ================= */
function renderN(){
  const N=store.get('k2notes',[]);
  $('nlist').innerHTML=N.length?N.map((n,i)=>`<div class="note"><div class="note-h"><b>${esc(n.t||'Без названия')}</b><button class="del" data-i="${i}" aria-label="Удалить">×</button></div><time>${esc(n.d)}</time><p>${esc(n.b)}</p></div>`).join(''):emptyBox('📝','Тут будут твои рецепты','Нашёл идеальные настройки для PETG? Запиши — через месяц скажешь себе спасибо.');
}
$('nadd').onclick=()=>{
  const t=$('nt').value.trim(),b=$('nb').value.trim();
  if(!t&&!b){shake($('nt'));toast('Напиши хоть пару слов — название или настройки');return}
  const N=store.get('k2notes',[]);N.unshift({t,b,d:today()});
  store.set('k2notes',N);$('nt').value='';$('nb').value='';renderN();buzz(10);toast('Записал! 📝');
};
$('nlist').onclick=e=>{const d=e.target.closest('.del');if(!d)return;
  const i=+d.dataset.i,N=store.get('k2notes',[]),[gone]=N.splice(i,1);store.set('k2notes',N);renderN();buzz(15);
  toast('Заметка удалена',()=>{const N2=store.get('k2notes',[]);N2.splice(i,0,gone);store.set('k2notes',N2);renderN()})};
$('myseg').onclick=e=>{const b=e.target.closest('button');if(!b)return;
  [...$('myseg').children].forEach(x=>x.classList.toggle('on',x===b));
  $('my-care').hidden=b.dataset.v!=='care';$('my-notes').hidden=b.dataset.v!=='notes'};

/* ================= ОБЩЕЕ ================= */
document.addEventListener('click',e=>{const h=e.target.closest('.card-h');if(h)h.parentElement.classList.toggle('open')});
function go(id){
  document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.s===id));
  document.querySelectorAll('main>section').forEach(s=>s.classList.toggle('active',s.id===id));window.scrollTo(0,0);
  if(id==='s-video'&&!vStarted){vStarted=true;renderV();loadFeeds(false)}
}
$('nav').onclick=e=>{const b=e.target.closest('button');if(b)go(b.dataset.s)};
renderTip();renderPChips();renderP();renderPr();renderMat();renderBrands();renderG();renderM();renderN();
