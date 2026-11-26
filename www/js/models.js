/* Идеи → Модели: поиск по MakerWorld и Printables.
   Открытые поисковые API этих сайтов (без ключей). На телефоне запросы идут через CapacitorHttp.
   Модели с пометкой 18+ (nsfw) не показываем. Скачивание — на странице модели. */
const MOD_IDEAS=[['','🔥 Популярное'],['organizer','Органайзеры'],['kitchen','Кухня'],['home decor','Для дома'],['desk','Рабочий стол'],
  ['toy','Игрушки'],['gift','Подарки'],['print in place','Без сборки'],['3d printer upgrade','Для принтера'],['garden','Сад'],['car','Авто'],['tool','Инструменты']];
const MOD_SRC=[['all','Все сайты'],['mw','MakerWorld'],['pr','Printables'],['fav','★ Сохранённые']];
const MS={q:'',idea:'',src:'all',page:0,items:[],busy:false,more:false,started:false,seq:0};
const PAGE=12;

const kfmt=n=>{n=+n||0;return n>=1e6?(n/1e6).toFixed(1).replace('.',',')+' млн':n>=1e3?(n/1e3).toFixed(n>=1e4?0:1).replace('.',',')+' тыс':String(n)};
const modKey=m=>m.s+':'+m.id;

async function searchMW(q,page){
  const u='https://makerworld.com/api/v1/search-service/select/design2?limit='+PAGE+'&offset='+page*PAGE+(q?'&keyword='+encodeURIComponent(q):'&orderBy=hotScore');
  const d=JSON.parse(await fetchText(u));
  return (d.hits||[]).filter(h=>h&&!h.nsfw&&h.id).map(h=>({s:'mw',id:h.id,
    t:(/[぀-ヿ一-鿿]/.test(h.title||'')&&h.titleTranslated)?h.titleTranslated:(h.title||''),
    a:(h.designCreator||{}).name||'',l:h.likeCount,dl:h.downloadCount,
    img:h.cover?h.cover+'?x-oss-process=image/resize,w_400/format,webp':'',full:h.cover||'',
    url:'https://makerworld.com/en/models/'+h.id+(h.slug?'-'+h.slug:'')}));
}
async function searchPR(q,page){
  const body=JSON.stringify({query:'query S($q:String!,$l:Int,$o:Int,$ord:SearchChoicesEnum){searchPrints2(query:$q,limit:$l,offset:$o,ordering:$ord){items{id name slug nsfw likesCount downloadCount premium price image{filePath} user{publicUsername}}}}',
    variables:q?{q,l:PAGE,o:page*PAGE}:{q:'',l:PAGE,o:page*PAGE,ord:'popular'}});
  const d=JSON.parse(await fetchText('https://api.printables.com/graphql/',{method:'POST',headers:{'content-type':'application/json'},body}));
  if(d.errors&&!d.data)throw new Error('printables');
  return (((d.data||{}).searchPrints2||{}).items||[]).filter(x=>x&&!x.nsfw).map(x=>{
    const fp=(x.image||{}).filePath||'',m=fp.match(/^(.*)\/([^/]+)\.(\w+)$/);
    return {s:'pr',id:x.id,t:x.name||'',a:(x.user||{}).publicUsername||'',l:x.likesCount,dl:x.downloadCount,paid:!!(x.premium||x.price),
      img:m?`https://media.printables.com/${m[1]}/thumbs/inside/320x240/${m[3].toLowerCase()}/${m[2]}.webp`:'',full:fp?'https://media.printables.com/'+fp:'',
      url:'https://www.printables.com/model/'+x.id+(x.slug?'-'+x.slug:'')};
  });
}

function modCard(m,fav){
  const on=fav.has(modKey(m));
  return `<div class="mod"><a class="mimg" href="${esc(m.url)}" target="_blank" rel="noopener">${m.img?`<img loading="lazy" alt="" src="${esc(m.img)}" data-full="${esc(m.full)}" onerror="if(this.dataset.full&&this.src!==this.dataset.full){this.src=this.dataset.full}else{this.remove()}">`:''}<span class="msrc ${m.s}">${m.s==='mw'?'MakerWorld':'Printables'}</span>${m.paid?'<span class="mpaid">платная</span>':''}</a>
    <div class="mt"><a href="${esc(m.url)}" target="_blank" rel="noopener"><b>${esc(m.t)}</b></a><span>${esc(m.a)}</span>
    <div class="mst"><span>♥ ${kfmt(m.l)}</span><span>⬇ ${kfmt(m.dl)}</span><button class="mfav ${on?'on':''}" data-fav="${esc(modKey(m))}" aria-label="Сохранить">${on?'★':'☆'}</button></div></div></div>`;
}
function otherSites(){
  const q=MS.q||MS.idea;if(!q)return '';const u=encodeURIComponent(q);
  return `<div class="lbl">Поискать «${esc(q)}» ещё</div><div class="vlinks">
    <a href="https://www.thingiverse.com/search?q=${u}&type=things" target="_blank" rel="noopener">Thingiverse</a>
    <a href="https://cults3d.com/en/search?q=${u}" target="_blank" rel="noopener">Cults3D</a>
    <a href="https://thangs.com/search/${u}?scope=all" target="_blank" rel="noopener">Thangs</a>
    <a href="https://www.printables.com/search/models?q=${u}" target="_blank" rel="noopener">Printables</a>
    <a href="https://makerworld.com/en/search/models?keyword=${u}" target="_blank" rel="noopener">MakerWorld</a></div>`;
}
function renderMods(msg){
  $('msrc').innerHTML=chips(MOD_SRC,MS.src);
  $('mideas').innerHTML=MS.src==='fav'?'':chips(MOD_IDEAS,MS.q?'\u0000':MS.idea);
  const favList=store.get('k2models',[]),fav=new Set(favList.map(modKey));
  const st=$('mstatus');st.classList.toggle('busy',MS.busy);
  if(MS.src==='fav'){
    st.textContent=favList.length?'Сохранено моделей: '+favList.length:'';$('mmore').hidden=true;$('mother').innerHTML='';
    $('modlist').innerHTML=favList.length?`<div class="mgrid">${favList.map(m=>modCard(m,fav)).join('')}</div>`
      :emptyBox('⭐','Пока ничего не сохранено','Нажми ☆ на понравившейся модели — она появится здесь и будет доступна без интернета.');
    return;
  }
  st.textContent=msg!=null?msg:MS.busy?'Ищу модели…':'';
  $('modlist').innerHTML=MS.items.length?`<div class="mgrid">${MS.items.map(m=>modCard(m,fav)).join('')}</div>`
    :MS.busy?emptyBox('🧩','Ищу модели…','Спрашиваю у MakerWorld и Printables.')
    :emptyBox('🔍','Ничего не нашлось',(MS.q&&/[а-яё]/i.test(MS.q)?'Попробуй по-английски — моделей с английскими названиями намного больше. ':'')+'Или поищи на других сайтах ниже.');
  $('mmore').hidden=!MS.more||MS.busy;
  $('mother').innerHTML=otherSites();
}
async function loadMods(reset){
  if(MS.src==='fav'){renderMods();return}
  if(reset){MS.page=0;MS.items=[]}
  const my=++MS.seq;MS.busy=true;renderMods();
  const q=MS.q||MS.idea,srcs=MS.src==='all'?['mw','pr']:[MS.src];
  const res=await Promise.allSettled(srcs.map(s=>(s==='mw'?searchMW:searchPR)(q,MS.page)));
  if(my!==MS.seq)return; // пользователь уже ищет другое
  MS.busy=false;
  const ok=res.filter(r=>r.status==='fulfilled').map(r=>r.value);
  // перемешиваем выдачу сайтов через одну, без дублей
  const seen=new Set(MS.items.map(modKey)),add=[];
  for(let i=0;i<PAGE;i++)ok.forEach(L=>{const m=L[i];if(m&&!seen.has(modKey(m))){seen.add(modKey(m));add.push(m)}});
  MS.items=MS.items.concat(add);MS.more=ok.some(L=>L.length>=PAGE*0.5);
  const failed=res.filter(r=>r.status==='rejected').length;
  renderMods(!ok.length&&failed?'Нет связи с сайтами моделей — проверь интернет':
    failed?`${srcs[res.findIndex(r=>r.status==='rejected')]==='mw'?'MakerWorld':'Printables'} не ответил — показываю остальное`:'');
}
function startModels(){if(MS.started)return;MS.started=true;loadMods(true)}

$('mform').onsubmit=e=>{e.preventDefault();$('mq').blur();MS.q=$('mq').value.trim();MS.idea='';if(MS.src==='fav')MS.src='all';loadMods(true)};
$('mq').addEventListener('search',()=>{if(!$('mq').value.trim()&&MS.q){MS.q='';loadMods(true)}});
$('msrc').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;MS.src=b.dataset.v;
  if(MS.src==='fav')renderMods();else loadMods(true)};
$('mideas').onclick=e=>{const b=e.target.closest('.chip');if(!b)return;MS.idea=b.dataset.v;MS.q='';$('mq').value='';loadMods(true)};
$('mmore').onclick=()=>{MS.page++;loadMods(false)};
$('modlist').addEventListener('click',e=>{const b=e.target.closest('[data-fav]');if(!b)return;e.preventDefault();
  const k=b.dataset.fav,L=store.get('k2models',[]),i=L.findIndex(m=>modKey(m)===k);
  if(i>=0){const [gone]=L.splice(i,1);store.set('k2models',L);renderMods();buzz(8);
    toast('Убрано из сохранённых',()=>{const L2=store.get('k2models',[]);L2.splice(i,0,gone);store.set('k2models',L2);renderMods()})}
  else{const m=MS.items.find(m=>modKey(m)===k);if(!m)return;L.unshift(m);store.set('k2models',L);renderMods();buzz(12);toast('Сохранено ⭐ — смотри в «★ Сохранённые»')}
});
$('iseg').onclick=e=>{const b=e.target.closest('button');if(!b)return;
  [...$('iseg').children].forEach(x=>x.classList.toggle('on',x===b));
  $('i-models').hidden=b.dataset.v!=='models';$('i-video').hidden=b.dataset.v!=='video';
  if(b.dataset.v==='video')startVideo();else startModels()};
