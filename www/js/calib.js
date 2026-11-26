/* Вкладка «Инструменты»: мастера калибровки.
   Формулы: Klipper Rotation_Distance.md и Pressure_Advance.md, Marlin M92, вики Orca Slicer (Flow rate, 2 прохода). */
function calibHTML(){
  const c=store.get('k2calib',{});const v=(k,d)=>esc(c[k]!=null?c[k]:d);
  const inp=(id,l,d,extra='')=>`<div><label>${l}</label><input class="f" type="number" inputmode="decimal" id="${id}" value="${v(id,d)}" ${extra}></div>`;
  return `<div class="chips-lbl" style="margin-top:16px">Калибровка</div>`
  +card('🧪','Экструдер: E-steps / rotation_distance','сколько прутка реально подаётся',`
    <ol><li>Нагрей сопло до температуры пластика.</li><li>Отметь маркером пруток на <b>120 мм</b> выше входа в экструдер.</li>
    <li>Выдави <b>100 мм</b> медленно: Marlin — <code>M83</code>, затем <code>G1 E100 F100</code>; Klipper — <code>G91</code>, затем <code>G1 E100 F60</code>.</li>
    <li>Измерь расстояние от входа до метки и впиши ниже.</li></ol>
    <div class="fgrid"><div><label>Прошивка</label><select class="f" id="k-fw"><option value="marlin" ${c['k-fw']==='klipper'?'':'selected'}>Marlin (E-steps)</option><option value="klipper" ${c['k-fw']==='klipper'?'selected':''}>Klipper (rotation_distance)</option></select></div>
    ${inp('k-old','Текущее значение',93)}${inp('k-mark','Метка, мм',120)}${inp('k-req','Просил выдавить, мм',100)}${inp('k-left','Осталось до метки, мм',20)}</div>
    <div class="res" id="k-res1"></div>
    <div class="tip">💡 Принтеры с закрытой прошивкой (Bambu Lab, Creality K2) калибруют подачу сами — им этот шаг обычно не нужен. Если ошибка больше 2 мм, повтори замер с новым значением.</div>`)
  +card('🌊','Поток (Flow ratio)','по тестовым образцам Orca Slicer',`
    <p>Orca Slicer → Калибровка → «Скорость потока», классический тест в 2 прохода. На каждом блоке подписан модификатор: выбери самый гладкий верх без щелей и наплывов.</p>
    <div class="fgrid">${inp('k-fr','Текущий Flow ratio',0.98,'step="0.001"')}${inp('k-mod','Модификатор лучшего блока',5)}</div>
    <div class="res" id="k-res2"></div>
    <div class="tip">💡 Если в твоей версии Orca на образце сразу написано итоговое значение — просто впиши его в профиль пластика. Калибруй поток для каждой новой марки пластика.</div>`)
  +card('🗼','Pressure Advance (Klipper, башня)','PA = START + высота × FACTOR',`
    <p>Команда перед печатью башни (по документации Klipper): <code>TUNING_TOWER COMMAND=SET_PRESSURE_ADVANCE PARAMETER=ADVANCE START=0 FACTOR=.005</code> для директ-экструдера или <code>FACTOR=.020</code> для боудена. Найди высоту, где углы самые ровные, и измерь её штангенциркулем.</p>
    <div class="fgrid">${inp('k-ps','START',0,'step="0.001"')}${inp('k-pf','FACTOR',0.005,'step="0.001"')}${inp('k-ph','Высота лучшего места, мм',10)}</div>
    <div class="res" id="k-res3"></div>
    <div class="tip">💡 В Orca Slicer тесты PA подписаны готовыми значениями — выбери лучшее и впиши в профиль пластика.</div>`)
  +card('🌡️','Башня: температура, ретракт и другое','значение по высоте',`
    <p>Для любой «башни», где параметр меняется ступенями: укажи начальное значение, шаг (минус, если значение убывает) и высоту ступени. Затем — высоту лучшего места.</p>
    <div class="fgrid">${inp('k-ts','Начальное значение',230)}${inp('k-tst','Шаг на ступень',-5)}${inp('k-th','Высота ступени, мм',10)}${inp('k-tm','Высота лучшего места, мм',25)}</div>
    <div class="res" id="k-res4"></div>`)
  +card('📐','Размеры и усадка','масштаб для точных деталей',`
    <p>Напечатай кубик (например, 20 мм), измерь штангенциркулем по X/Y. Масштаб ниже компенсирует усадку пластика — особенно у ABS, ASA и нейлона.</p>
    <div class="fgrid">${inp('k-de','Должно быть, мм',20)}${inp('k-dm','Получилось, мм',19.85)}</div>
    <div class="res" id="k-res5"></div>
    <div class="tip">💡 Если неточны только отверстия — дело не в усадке: смотри «Крепёж и допуски» ниже на этой же вкладке. Масштаб применяй к пластику, а не к принтеру.</div>`);
}
function calibCalc(){
  if(!$('k-res1'))return;
  const n=id=>{const x=parseFloat(String($(id).value).replace(',','.'));return isFinite(x)?x:0};
  const f=(x,d=3)=>x.toLocaleString('ru-RU',{maximumFractionDigits:d});
  const save={};['k-fw','k-old','k-mark','k-req','k-left','k-fr','k-mod','k-ps','k-pf','k-ph','k-ts','k-tst','k-th','k-tm','k-de','k-dm'].forEach(id=>save[id]=$(id).value);store.set('k2calib',save);
  // 1. экструдер
  const fw=$('k-fw').value,old=n('k-old'),act=n('k-mark')-n('k-left'),req=n('k-req');
  let r1='<div style="color:var(--muted)">Впиши замеры выше</div>';
  if(old>0&&act>0&&req>0){
    const nv=fw==='klipper'?old*act/req:old*req/act,err=act-req;
    r1=`<div><span>Выдавлено на деле</span><b>${f(act,1)} мм (${err>=0?'+':''}${f(err,1)})</b></div>
      <div class="tot"><span>Новое значение</span><span>${f(nv)}</span></div>
      <div style="color:var(--muted);font-size:13px"><span>${fw==='klipper'?`В printer.cfg, секция [extruder]: <code>rotation_distance: ${f(nv).replace(',','.')}</code>`:`Команды: <code>M92 E${f(nv,2).replace(',','.')}</code>, затем <code>M500</code>`}</span></div>`;
  }
  $('k-res1').innerHTML=r1;
  // 2. поток
  const fr=n('k-fr'),nf=fr*(100+n('k-mod'))/100;
  $('k-res2').innerHTML=fr>0?`<div class="tot" style="border:none;margin:0;padding:0"><span>Новый Flow ratio</span><span>${f(nf,4)}</span></div><div style="color:var(--muted);font-size:13px"><span>= ${f(fr,4)} × (100 ${n('k-mod')>=0?'+':'−'} ${f(Math.abs(n('k-mod')),1)}) / 100. После первого прохода сделай второй (модификаторы от −9 до 0) с новым значением.</span></div>`:'';
  // 3. PA
  const pa=n('k-ps')+n('k-ph')*n('k-pf');
  $('k-res3').innerHTML=`<div class="tot" style="border:none;margin:0;padding:0"><span>pressure_advance</span><span>${f(pa,4)}</span></div><div style="color:var(--muted);font-size:13px"><span>В printer.cfg, секция [extruder]: <code>pressure_advance: ${f(pa,4).replace(',','.')}</code></span></div>`;
  // 4. башня
  const th=n('k-th'),step=th>0?Math.floor(n('k-tm')/th):0,tv=n('k-ts')+step*n('k-tst');
  $('k-res4').innerHTML=th>0?`<div class="tot" style="border:none;margin:0;padding:0"><span>Значение</span><span>${f(tv,3)}</span></div><div style="color:var(--muted);font-size:13px"><span>Это ${step+1}-я ступень снизу. Если лучшее место на границе ступеней — возьми среднее соседних значений.</span></div>`:'';
  // 5. размеры
  const de=n('k-de'),dm=n('k-dm');
  $('k-res5').innerHTML=de>0&&dm>0?`<div class="tot" style="border:none;margin:0;padding:0"><span>Масштаб модели</span><span>${f(de/dm*100,2)} %</span></div><div><span>Или Shrinkage (XY) в Orca Slicer</span><b>${f(dm/de*100,2)} %</b></div><div style="color:var(--muted);font-size:13px"><span>Усадка ${f((de-dm)/de*100,2)} %. Shrinkage — в профиле пластика Orca: туда пишут, сколько процентов размера остаётся (вместо 100 мм получилось 99,5 → 99,5 %). Используй что-то одно: масштаб или Shrinkage.</span></div>`:'';
}
