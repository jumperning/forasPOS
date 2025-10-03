// ================== Mostrar/Ocultar montos ==================
let mostrarMoneda = true;
function toggleMoneda(){
  mostrarMoneda = !mostrarMoneda;
  document.body.classList.toggle('hide-money', !mostrarMoneda);
}
$('#btnToggleMoneda').on('click', toggleMoneda);

// ================== Utils ==================
const $fmt = n => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const dayKey   = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const toNumber = x => (typeof x==='number') ? x :
  Number(String(x??'').replace(/[^\d,.\-]/g,'').replace(/\.(?=.*\.)/g,'').replace(',', '.')) || 0;

function diag(m){ const el=document.getElementById('diag'); el.innerHTML += `<div>• ${m}</div>`; }
function parseJSONSafely(s){ try{ return JSON.parse(s); }catch{ return null; } }
function parseDateSmart(s){
  if(!s) return null;
  if(!isNaN(Number(s)) && String(s).trim()!==''){ const base=new Date(Date.UTC(1899,11,30)); return new Date(base.getTime()+Number(s)*86400000); }
  const d=new Date(s); return isNaN(d)? null : d;
}
const safeDateOrToday = s => parseDateSmart(s) || new Date();

function findItemsJSON(row){
  const pref = ['items(json)','items','detalle'];
  for(const k of pref){ if(row[k]) return String(row[k]); }
  for(const [k,v] of Object.entries(row)){
    if(typeof v === 'string' && /[\[\{].*[\]\}]/.test(v)) return v;
  }
  return '';
}
function ensureItemsArray(raw){
  if(Array.isArray(raw)) return raw;
  if(typeof raw==='string'){
    const cleaned = raw.trim().replace(/""/g,'"');
    const parsed = parseJSONSafely(cleaned);
    if(Array.isArray(parsed)) return parsed;
    if(parsed && typeof parsed==='object'){
      if(Array.isArray(parsed.items)) return parsed.items;
      const out=[]; for(const [k,v] of Object.entries(parsed)){ const q=toNumber(v); if(k && q){ out.push({nombre:k, qty:q}); } }
      return out;
    }
    return [];
  }
  if(raw && typeof raw==='object'){
    if(Array.isArray(raw.items)) return raw.items;
    const out=[]; for(const [k,v] of Object.entries(raw)){ const q=toNumber(v); if(k && q){ out.push({nombre:k, qty:q}); } }
    return out;
  }
  return [];
}

// ====== Canonización ======
const stripAccents = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const normKey = s => stripAccents(String(s||'').toLowerCase()).replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const CANON = {};
const CANON_RULES = [];

function isNoiseItemName(nRaw){
  const n = normKey(nRaw);
  if(!n) return true;
  if(/^gasto\b/.test(n)) return true;
  if(/^(turno|cerramos el turno|pero fue|—|->)/.test(nRaw.toLowerCase())) return true;
  if(/^\d+(\.\d+)?$/.test(n)) return true;
  if(n.length <= 1) return true;
  return false;
}
function canonizarNombre(nRaw){
  if(!nRaw) return '';
  const key = normKey(nRaw);
  if(CANON[key]) return CANON[key];
  for(const {re,to} of CANON_RULES){ if(re.test(nRaw)) return to; }
  if(/cafe.*(medialuna|jyq)/i.test(nRaw)) return "PROMO: 2 Medialunas + Café con leche";
  return nRaw.replace(/\s+/g,' ').trim();
}
function canonicalizeAndMerge(items){
  const map = new Map();
  for(const it of (items||[])){
    const nombre = (it.nombre||'').toString();
    if(isNoiseItemName(nombre)) continue;
    const canon = canonizarNombre(nombre);
    const qty   = toNumber(it.qty);
    const precio= toNumber(it.precio);
    const costo = toNumber(it.costo);
    if(!canon || !qty) continue;
    if(!map.has(canon)){
      map.set(canon, { nombre: canon, qty: 0, ingreso: 0, costo: 0, veces:0 });
    }
    const acc = map.get(canon);
    acc.qty    += qty;
    acc.ingreso+= precio * qty;
    acc.costo  += costo  * qty;
    acc.veces  += 1;
  }
  return Array.from(map.values()).map(r => ({
    nombre: r.nombre,
    qty: r.qty,
    ingreso: r.ingreso,
    costo:  r.costo,
    ganancia: r.ingreso - r.costo,
    precio: r.qty ? r.ingreso / r.qty : 0,
    veces: r.veces
  }));
}

function normalizeRow(row){
  const timestamp = row.timestamp || row.fecha || row.Timestamp || '';
  let cliente   = row.cliente || row.Cliente || '';
  let mesa      = row.mesa || row.Mesa || '';
  let metodo    = row.metodoPago || row.metodo || row.Metodo || '';

  if(!mesa && /^mesa\s*\d+/i.test(String(cliente))) { mesa = cliente; cliente = ''; }

  let total = toNumber(row.total);
  if(!total) total = toNumber(row.ganancia);
  if(!total) total = toNumber(row.totalCosto);
  if(!total) total = toNumber(row.pago);

  let totalCosto = toNumber(row.totalCosto || row.costoTotal || 0);
  let ganancia   = toNumber(row.ganancia || 0);

  const itemsStr = findItemsJSON(row);
  let items = ensureItemsArray(itemsStr).map(it=>({
    nombre: it.nombre || it.producto || it.item || '',
    qty: toNumber(it.qty || it.cantidad || 0),
    precio: toNumber(it.precio || it.price || 0),
    costo: toNumber(it.costo || it.cost || 0)
  })).filter(x=>x.nombre && x.qty);

  items = canonicalizeAndMerge(items);

  if(!totalCosto && items.length){
    totalCosto = items.reduce((a,i)=> a + toNumber(i.costo)*toNumber(i.qty), 0);
  }
  if(!ganancia){ ganancia = total - totalCosto; }

  if(!metodo){
    const candidates = [row.metodoPago, row.totalCosto, row.forma, row.Forma];
    const m = (candidates.find(x => typeof x==='string' && x.length && x.length<25) || '').toString();
    metodo = m;
  }

  const date = safeDateOrToday(timestamp);
  return { date, timestamp, cliente, mesa, metodo, total, totalCosto, ganancia, items };
}

// ================== Estado global ==================
let VENTAS=[], VENTAS_FILTRADAS=[], expandir=false;

// Paginación
const PAGE_SIZE = 15;
let currentPage = 1;

// Filtros visibles (panel)
const FILTER_KEYS = ['filtMes','filtDia','filtHorario','filtBuscar','filtCategoria'];
const DEFAULT_VISIBLE = {filtMes:true, filtDia:true, filtHorario:false, filtBuscar:true, filtCategoria:false};

function loadVisibleFilters(){
  const raw = localStorage.getItem('visibleFilters');
  const saved = raw ? parseJSONSafely(raw) : null;
  return Object.assign({}, DEFAULT_VISIBLE, saved||{});
}
function applyVisibleFilters(){
  const vis = loadVisibleFilters();
  FILTER_KEYS.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.classList.toggle('hidden', !vis[id]);
  });
}
function openFiltrosPanel(){
  const vis = loadVisibleFilters();
  document.querySelectorAll('#panelFiltros .chkFilt').forEach(chk=>{
    chk.checked = !!vis[chk.value];
  });
  document.getElementById('panelFiltros').classList.remove('hidden');
}
function closeFiltrosPanel(){
  document.getElementById('panelFiltros').classList.add('hidden');
}
function saveFiltrosFromPanel(){
  const vis = {};
  document.querySelectorAll('#panelFiltros .chkFilt').forEach(chk=>{
    vis[chk.value] = chk.checked;
  });
  localStorage.setItem('visibleFilters', JSON.stringify(vis));
  applyVisibleFilters();
  closeFiltrosPanel();
}

// ================== Día + horario ==================
function setDia(dateObj){
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth()+1).padStart(2,'0');
  const dd = String(dateObj.getDate()).padStart(2,'0');
  $('#diaFiltro').val(`${yyyy}-${mm}-${dd}`);
  renderKPIs(); renderCharts(); renderCierre(); renderExplorer(); renderHoras();
}
function getDiaKeySeleccionado(){
  const v = $('#diaFiltro').val();
  if(!v) return dayKey(new Date());
  const d = new Date(v+'T00:00:00');
  return dayKey(d);
}
function parseHHMM(v){ if(!v) return null; const [h,m]=v.split(':').map(n=>parseInt(n,10)); if(Number.isNaN(h)||Number.isNaN(m)) return null; return h*60+m; }
function withinHourRange(d){
  const desde=parseHHMM($('#horaDesde').val()); const hasta=parseHHMM($('#horaHasta').val());
  if(desde===null && hasta===null) return true;
  const mins=d.getHours()*60+d.getMinutes();
  if(desde!==null && hasta!==null){ return (hasta>=desde)? (mins>=desde && mins<=hasta) : (mins>=desde || mins<=hasta); }
  if(desde!==null) return mins>=desde;
  if(hasta!==null) return mins<=hasta;
  return true;
}

function cargarMeses(){
  const sel=$('#mesFiltro'); sel.empty();
  const keys=[...new Set(VENTAS.map(v=>monthKey(v.date)))].sort().reverse();
  keys.forEach(k=> sel.append(`<option value="${k}">${k}</option>`));
  if(keys.length) sel.val(keys[0]);
}

// ================== Categorización ==================
const CAT_LABELS = ['Café','Comida','Cerveza','Gaseosa','Agua','Vino','Whisky','Tragos'];
function categorizar(nombre){
  const n=(nombre||'').toLowerCase();
  if (/(agua (?!t[oó]nica)|agua$|botella de agua|eco de los andes|villavicencio|bonaqu|glaciar)/.test(n)) return 'Agua';
  if (/(cafe|café|espresso|expreso|americano|latte|capuch|cortado|moka|macchiato|frapp|flat white|ristretto)/.test(n)) return 'Café';
  if (/(cerveza|birra|ipa|apa|stout|golden|pale|lager|porter|pilsen|pinta|media pinta|sch(opp)?|330ml|473ml|500ml|600ml)/.test(n)) return 'Cerveza';
  if (/(vino|malbec|cabernet|merlot|syrah|pinot|blend|rioja|tempranillo|chardonnay|sauvignon|torrontés|espumante|champ|prosecco)/.test(n)) return 'Vino';
  if (/(whisky|whiskey|bourbon|scotch|jack daniels|johnnie walker|jb|chivas|ballantines|old parr)/.test(n)) return 'Whisky';
  if (/(trago|c[oó]ctel|cocktail|gin tonic|gintonic|fernet|aperol|campari|negroni|mojito|caipiri|daikiri|margarita|ron cola|cuba libre|destornillador|vodka|tequila|gancia|cynar|spritz)/.test(n)) return 'Tragos';
  if (/(gaseosa|coca|sprite|fanta|pepsi|manaos|pomelo|cola|ginger ale|agua t[oó]nica|t[oó]nica|schweppes|pesi)/.test(n)) return 'Gaseosa';
  if (/(hamburg|burger|sandw|tostado|papas|papitas|fritas|pollo|milanesa|pizza|empanada|lomito|wrap|ensalada|taco|nacho|arepa|pancho|picada|tarta|tortilla|postre|alfajor|torta|budin|budín|brownie|medialuna|factura)/.test(n)) return 'Comida';
  return 'Comida';
}

// ================== Filtros base ==================
function aplicarFiltros(){
  const mes=$('#mesFiltro').val();
  const q=($('#buscar').val()||'').toLowerCase();
  const catSel = $('#catFiltro').val();

  VENTAS_FILTRADAS = VENTAS.filter(v => {
    const okMes = monthKey(v.date)===mes;
    const texto = `${v.cliente} ${v.mesa} ${(v.items||[]).map(i=>i.nombre).join(' ')}`.toLowerCase();
    const okBuscar = !q || texto.includes(q);
    const okCat = !catSel || (v.items||[]).some(i => categorizar(i.nombre)===catSel);
    return okMes && okBuscar && okCat;
  });

  currentPage = 1;

  renderKPIs();
  renderTabla();
  renderPaginador();
  renderCharts();
  renderExplorer();
  renderHoras();
}

// ================== Alcance ==================
function getVentasAlcance(){
  const alcance = $('#alcanceSel').val();
  if(alcance==='dia'){
    const clave = getDiaKeySeleccionado();
    return VENTAS.filter(v => dayKey(v.date)===clave && withinHourRange(v.date));
    }
  if(alcance==='rango'){
    const d1 = $('#desdeFecha').val();
    const d2 = $('#hastaFecha').val();
    if(!d1 || !d2) return [];
    const from = new Date(d1+'T00:00:00'); const to = new Date(d2+'T23:59:59');
    return VENTAS.filter(v => v.date>=from && v.date<=to);
  }
  const mesSel = $('#mesFiltro').val();
  return VENTAS.filter(v => monthKey(v.date)===mesSel);
}

// ================== Agregados categoría ==================
function aggregateByCategory(ventas){
  const base = Object.fromEntries(CAT_LABELS.map(c=>[c, {unidades:0, veces:0, ganancia:0}]));
  ventas.forEach(v=>{
    const items = v.items||[];
    const totalImporteItems = items.reduce((a,i)=> a + toNumber(i.precio)*toNumber(i.qty), 0);
    const gananciaTicket = toNumber(v.ganancia);
    items.forEach(i=>{
      const cat = categorizar(i.nombre);
      const qty = toNumber(i.qty);
      const precio = toNumber(i.precio);
      const costo = toNumber(i.costo);
      const importe = precio * qty;
      let gan = 0;
      if(costo){ gan = (precio - costo) * qty; }
      else if(totalImporteItems>0 && gananciaTicket){ gan = gananciaTicket * (importe / totalImporteItems); }
      base[cat].unidades += qty; base[cat].veces += 1; base[cat].ganancia += gan;
    });
  });
  CAT_LABELS.forEach(c=>{ base[c].unidades=Math.round(base[c].unidades); base[c].ganancia=Math.round(base[c].ganancia); });
  return base;
}
function aggregateByDayAndCategory(ventas){
  const byDay = {};
  ventas.forEach(v=>{
    const dk = dayKey(v.date);
    if(!byDay[dk]) byDay[dk] = Object.fromEntries(CAT_LABELS.map(c=>[c,{unidades:0}]));
    (v.items||[]).forEach(i=>{
      const cat = categorizar(i.nombre);
      byDay[dk][cat].unidades += toNumber(i.qty);
    });
  });
  return byDay;
}

// ================== Medios de pago (helpers para KPIs del mes) ==================
const isEfectivo = (m) => /efec/.test(String(m||'').toLowerCase());
const isMP       = (m) => /(mercado\s*pago|\bmp\b)/.test(String(m||'').toLowerCase());

// ================== KPIs / Tabla ==================
function renderKPIs(){
  // ——— KPIs de la tabla filtrada (como ya tenías) ———
  $('#kpiVentas').text(VENTAS_FILTRADAS.length);
  const unidadesMesFiltrado=VENTAS_FILTRADAS.reduce((a,v)=>a+(v.items||[]).reduce((s,i)=>s+toNumber(i.qty),0),0);
  $('#kpiUnidades').text(unidadesMesFiltrado);
  const ingresosMesFiltrado=VENTAS_FILTRADAS.reduce((a,v)=>a+toNumber(v.total),0);
  $('#kpiIngresos').text($fmt(ingresosMesFiltrado));

  // ——— NUEVO: KPIs “del mes” IGNORANDO texto/categoría ———
  const mesSel = $('#mesFiltro').val();
  const baseMes = VENTAS.filter(v => monthKey(v.date)===mesSel);

  const ganMes = baseMes.reduce((a,v)=> a + toNumber(v.ganancia), 0);
  const efectivoMes = baseMes.filter(v=>isEfectivo(v.metodo)).reduce((a,v)=> a + toNumber(v.total), 0);
  const mpMes       = baseMes.filter(v=>isMP(v.metodo)).reduce((a,v)=> a + toNumber(v.total), 0);

  // Pinta solo si existen los elementos en el HTML
  const elGan = document.getElementById('kpiGanMes');
  if(elGan) elGan.textContent = $fmt(ganMes);

  const elEf = document.getElementById('kpiEfectivoMes');
  if(elEf) elEf.textContent = $fmt(efectivoMes);

  const elMP = document.getElementById('kpiMPMes');
  if(elMP) elMP.textContent = $fmt(mpMes);

  // ——— KPIs del día ———
  const claveDia = getDiaKeySeleccionado();
  const delDia = VENTAS.filter(v => dayKey(v.date) === claveDia && withinHourRange(v.date));
  const ganDia = delDia.reduce((a,v)=> a + toNumber(v.ganancia), 0);
  const ingDia = delDia.reduce((a,v)=> a + toNumber(v.total), 0);
  const uniDia = delDia.reduce((a,v)=> a + (v.items||[]).reduce((s,i)=> s + toNumber(i.qty), 0), 0);
  const ventasDia = delDia.length;
  const costoDia = delDia.reduce((a,v)=> a + toNumber(v.totalCosto), 0);
  $('#kpiGanDia').text($fmt(ganDia)); $('#kpiIngDia').text($fmt(ingDia)); $('#kpiUniDia').text(uniDia);
  $('#kpiVentasDia').text(ventasDia); $('#kpiCostoDia').text($fmt(costoDia));
  const hd = $('#horaDesde').val() || '--:--'; const hh = $('#horaHasta').val() || '--:--';
  const franja = (hd==='--:--' && hh==='--:--') ? '' : ` • ${hd}–${hh}`;
  $('#kpiGanDiaLbl').text(`Fecha: ${claveDia}${franja}`);
}

function renderTabla(){
  const tb=$('#tbodyVentas'); tb.empty();

  if(!VENTAS_FILTRADAS.length){
    tb.append(`<tr><td colspan="7" class="p-4 text-center text-sm text-gray-500">Sin datos</td></tr>`);
    return;
  }

  const total = VENTAS_FILTRADAS.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), pages);
  const from = (currentPage - 1) * PAGE_SIZE;
  const to = Math.min(from + PAGE_SIZE, total);
  const slice = VENTAS_FILTRADAS.slice(from, to);

  slice.forEach(v=>{
    const itemsTxt=(v.items&&v.items.length)
      ? v.items.map(i=> expandir? `${toNumber(i.qty)}× ${i.nombre} ($${toNumber(i.precio)})` : `${toNumber(i.qty)}× ${i.nombre}`).join(expandir? '\n' : ', ')
      : '-';
    tb.append(`<tr>
      <td class="p-2 align-top">${v.date.toLocaleString('es-AR')}</td>
      <td class="p-2 align-top">${v.cliente||'-'}</td>
      <td class="p-2 align-top">${v.mesa||'-'}</td>
      <td class="p-2 align-top">${v.metodo||'-'}</td>
      <td class="p-2 whitespace-pre-wrap">${itemsTxt}</td>
      <td class="p-2 align-top text-right font-semibold">${$fmt(toNumber(v.total))}</td>
      <td class="p-2 align-top text-right">${$fmt(toNumber(v.ganancia))}</td>
    </tr>`);
  });

  renderPaginador();
}

function renderPaginador(){
  const el = document.getElementById('paginador');
  if(!el) return;

  const total = VENTAS_FILTRADAS.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if(pages<=1){ el.innerHTML=''; return; }

  const from = (currentPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(currentPage * PAGE_SIZE, total);

  const pageButtons = [];
  const pushBtn = (p,label=String(p),disabled=false,active=false)=>{
    pageButtons.push(`<button data-page="${p}" class="px-2 py-1 rounded ${active?'bg-gray-900 text-white':'bg-gray-100 hover:bg-gray-200'} ${disabled?'opacity-50 cursor-not-allowed':''}" ${disabled?'disabled':''}>${label}</button>`);
  };

  pushBtn(currentPage-1,'«',currentPage===1);
  const set = new Set([1, pages, currentPage-1, currentPage, currentPage+1]);
  const sorted = [...set].filter(p=>p>=1 && p<=pages).sort((a,b)=>a-b);

  let prev = 0;
  for(const p of sorted){
    if(p - prev > 1){ pageButtons.push(`<span class="px-1">…</span>`); }
    pushBtn(p,String(p),false,p===currentPage);
    prev = p;
  }
  pushBtn(currentPage+1,'»',currentPage===pages);

  el.innerHTML = `
    <div class="text-xs text-gray-600">Mostrando ${from}-${to} de ${total}</div>
    <div class="flex items-center gap-1">${pageButtons.join('')}</div>
  `;
}

// ================== Charts (categoría) ==================
let PIE, BAR_QTY, BAR_PROF, DAILY_QTY, TOP_ITEMS, HORAS;
function destroyCharts(){
  [PIE,BAR_QTY,BAR_PROF,DAILY_QTY].forEach(c=>{ if(c) c.destroy(); });
  PIE=BAR_QTY=BAR_PROF=DAILY_QTY=null;
}
function renderCharts(){
  const diaDia = $('#chkDiaDia').is(':checked');
  const ventasBase = getVentasAlcance();
  const dataAgg = aggregateByCategory(ventasBase);
  const labels = CAT_LABELS;
  const qtyArr = labels.map(l=> dataAgg[l].unidades);
  const profitArr = labels.map(l=> dataAgg[l].ganancia);

  const tb = document.getElementById('tbodyResumenCat'); tb.innerHTML = '';
  labels.forEach(l=>{
    const r = dataAgg[l];
    tb.innerHTML += `<tr>
      <td class="p-2">${l}</td>
      <td class="p-2 text-right">${r.unidades}</td>
      <td class="p-2 text-right">${r.veces}</td>
      <td class="p-2 text-right">${$fmt(r.ganancia)}</td>
    </tr>`;
  });

  document.getElementById('aggWrap').classList.toggle('hidden', diaDia);
  document.getElementById('dailyWrap').classList.toggle('hidden', !diaDia);

  destroyCharts();

  if(diaDia){
    const byDay = aggregateByDayAndCategory(ventasBase);
    const days = Object.keys(byDay).sort();
    const datasets = CAT_LABELS.map((cat)=>({
      label: cat,
      data: days.map(d => byDay[d][cat]?.unidades || 0),
      stack: 's1'
    }));
    const ctx = document.getElementById('chartDailyQty').getContext('2d');
    DAILY_QTY = new Chart(ctx, {
      type: 'bar',
      data: { labels: days, datasets },
      options: {
        responsive:true,
        scales:{ x:{stacked:true}, y:{stacked:true, beginAtZero:true, ticks:{precision:0}}},
        plugins:{legend:{position:'bottom'}}
      }
    });
    return;
  }

  const ctxPie = document.getElementById('chartPie').getContext('2d');
  PIE = new Chart(ctxPie, {
    type: 'pie',
    data: { labels, datasets: [{ data: qtyArr }]},
    options: {
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = qtyArr.reduce((a,b)=>a+b,0)||1;
              const v = ctx.parsed;
              const p = (v*100/total).toFixed(1);
              return `${ctx.label}: ${v} (${p}%)`;
            }
          }
        }
      }
    }
  });

  const ctxBarQty = document.getElementById('chartBarQty').getContext('2d');
  BAR_QTY = new Chart(ctxBarQty, {
    type:'bar',
    data:{ labels, datasets:[{ label:'Unidades', data: qtyArr }]},
    options:{ scales:{ y:{ beginAtZero:true, ticks:{precision:0}}}, plugins:{legend:{display:false}} }
  });

  const ctxBarProf = document.getElementById('chartBarProfit').getContext('2d');
  BAR_PROF = new Chart(ctxBarProf, {
    type:'bar',
    data:{ labels, datasets:[{ label:'Ganancia (ARS)', data: profitArr }]},
    options:{
      scales:{ y:{ beginAtZero:true }},
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(ctx)=> `${$fmt(ctx.parsed.y)}` } } }
    }
  });
}

// ================== Explorador de Ítems ==================
function aggregateItems(ventas){
  const map = new Map();
  ventas.forEach(v=>{
    (v.items||[]).forEach(i=>{
      const nombre = i.nombre;
      const cat = categorizar(nombre);
      const qty = toNumber(i.qty);
      const ing = toNumber(i.precio)*qty;
      const gan = (toNumber(i.precio)-toNumber(i.costo))*qty;
      if(!map.has(nombre)) map.set(nombre,{ nombre, qty:0, ingreso:0, ganancia:0, veces:0, categoria:cat });
      const acc = map.get(nombre);
      acc.qty += qty; acc.ingreso += ing; acc.ganancia += gan; acc.veces += 1;
    });
  });
  return Array.from(map.values());
}

function renderExplorer(){
  const ventas = getVentasAlcance();
  const catSel = $('#itemCatSel').val()||'';
  const txt = ($('#itemTextSel').val()||'').trim().toLowerCase();
  const sort = $('#itemSortSel').val();
  const topN = Math.max(3, parseInt($('#itemTopN').val()||'10',10));

  let items = aggregateItems(ventas);
  if(catSel) items = items.filter(x=>x.categoria===catSel);
  if(txt) items = items.filter(x=> x.nombre.toLowerCase().includes(txt));

  items.sort((a,b)=> (toNumber(b[sort]) - toNumber(a[sort])) || (b.qty - a.qty));

  const tb = document.getElementById('tbodyItems'); tb.innerHTML='';
  items.forEach(r=>{
    tb.innerHTML += `<tr>
      <td class="p-2">${r.nombre}</td>
      <td class="p-2 text-right">${r.qty}</td>
      <td class="p-2 text-right">${r.veces}</td>
      <td class="p-2 text-right">${$fmt(r.ingreso)}</td>
      <td class="p-2 text-right">${$fmt(r.ganancia)}</td>
      <td class="p-2">${r.categoria}</td>
    </tr>`;
  });

  if(TOP_ITEMS) TOP_ITEMS.destroy();
  const top = items.slice(0, topN);
  const ctxTop = document.getElementById('chartTopItems').getContext('2d');
  TOP_ITEMS = new Chart(ctxTop, {
    type: 'bar',
    data: { labels: top.map(x=>x.nombre), datasets: [{ label: 'Unidades', data: top.map(x=>x.qty) }]},
    options: { indexAxis: 'y', scales:{ x:{ beginAtZero:true, ticks:{ precision:0 } }}, plugins:{ legend:{ display:false } } }
  });
}

// ================== Horarios ==================
let HORAS;
function renderHoras(){
  const ventas = getVentasAlcance();
  const buckets = Array.from({length:24},()=>0);
  ventas.forEach(v=>{ const h=v.date.getHours(); buckets[h]+= toNumber(v.total); });

  const maxVal = Math.max(...buckets);
  const maxIdx = buckets.indexOf(maxVal);
  document.getElementById('lblPeakHour').textContent = (maxVal>0) ? `Pico: ${String(maxIdx).padStart(2,'0')}:00 — ${$fmt(maxVal)}` : '';

  if(HORAS) HORAS.destroy();
  const ctxH = document.getElementById('chartHoras').getContext('2d');
  HORAS = new Chart(ctxH, {
    type:'bar',
    data:{ labels: Array.from({length:24},(_,h)=> String(h).padStart(2,'0')+':00'), datasets:[{ label:'Ingresos', data:buckets }] },
    options:{ scales:{ y:{ beginAtZero:true }}, plugins:{ legend:{ display:false } } }
  });
}

// ================== Carga CSV ==================
async function fetchCsvText(url){
  try{ const res=await fetch(url); if(!res.ok) throw new Error(`HTTP ${res.status}`); return await res.text(); }
  catch(err1){
    const proxied = 'https://r.jina.ai/http://' + url.replace(/^https?:\/\//,'');
    const res2 = await fetch(proxied);
    if(!res2.ok) throw new Error(`HTTP ${res2.status} (proxy). Error previo: ${err1?.message||err1}`);
    return await res2.text();
  }
}
function parseCsv(text){
  return new Promise((resolve,reject)=>{
    Papa.parse(text,{header:true,skipEmptyLines:true,complete:r=>resolve(r.data||[]),error:reject});
  });
}
async function cargarVentas(){
  try{
    $('#statusBadge').attr('class','text-xs px-3 py-1 rounded-full bg-blue-100 text-blue-700').text('Cargando…');
    document.getElementById('diag').innerHTML='';
    const url=document.getElementById('csvUrl').value.trim();
    const text=await fetchCsvText(url);
    const rows=await parseCsv(text);
    diag(`Filas: ${rows.length}`);
    diag('Encabezados: '+Object.keys(rows[0]||{}).join(', '));
    VENTAS=rows.map(normalizeRow);
    cargarMeses();
    applyVisibleFilters();
    setDia(new Date());
    aplicarFiltros();
    renderExplorer();
    renderHoras();
    $('#statusBadge').attr('class','text-xs px-3 py-1 rounded-full bg-emerald-100 text-emerald-700').text('Listo');
  }catch(err){
    $('#statusBadge').attr('class','text-xs px-3 py-1 rounded-full bg-red-100 text-red-700').text('Error');
    diag('Error: '+(err.message||err));
  }
}

// ================== Helpers export ==================
function buildItemsText(items, expandirFlag){
  if(!items || !items.length) return '-';
  return items
    .map(i => expandirFlag ? `${toNumber(i.qty)}× ${i.nombre} ($${toNumber(i.precio)})` : `${toNumber(i.qty)}× ${i.nombre}`)
    .join(expandirFlag ? '\n' : ', ');
}
function exportarExcel(){
  if(!VENTAS_FILTRADAS.length){ alert('No hay datos para exportar.'); return; }
  const data = VENTAS_FILTRADAS.map(v => ({
    'Fecha': v.date.toLocaleString('es-AR'),
    'Cliente': v.cliente || '-',
    'Mesa': v.mesa || '-',
    'Método': v.metodo || '-',
    'Items': buildItemsText(v.items, expandir),
    'Total (ARS)': Number(toNumber(v.total).toFixed(2)),
    'Ganancia (ARS)': Number(toNumber(v.ganancia).toFixed(2)),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{wch:20},{wch:20},{wch:12},{wch:16},{wch:50},{wch:14},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
  const mesSel = ($('#mesFiltro').val() || 'mes').replace(/[^0-9\-]/g,'');
  const t=new Date();
  const fname=`Ventas_OnceyDoce_${mesSel}_${t.getFullYear()}${String(t.getMonth()+1).padStart(2,'0')}${String(t.getDate()).padStart(2,'0')}_${String(t.getHours()).padStart(2,'0')}${String(t.getMinutes()).padStart(2,'0')}.xlsx`;
  XLSX.writeFile(wb, fname);
}
function mapCondicionVenta(metodo){
  const m = (metodo||'').toString().toLowerCase();
  if(/efec/.test(m)) return 'EFECTIVO';
  if(/mercado|mp/.test(m)) return 'MERCADO PAGO';
  if(/debito|débito/.test(m)) return 'TARJETA DE DÉBITO';
  if(/credito|crédito/.test(m)) return 'TARJETA DE CRÉDITO';
  if(/transfer/.test(m)) return 'TRANSFERENCIA BANCARIA';
  return 'OTROS MEDIOS DE PAGO ELECTRÓNICO';
}
function exportarExcelFact(){
  if(!VENTAS_FILTRADAS.length){ alert('No hay datos para exportar.'); return; }
  const rows = VENTAS_FILTRADAS.map(v => {
    const fechaObj = v.date;
    const totalNum = Number(toNumber(v.total).toFixed(2));
    return {
      'Fecha Comprobante': fechaObj,
      'Producto / Servicio': (v.items && v.items.length) ? buildItemsText(v.items, false) : '-',
      'Precio Unitario': totalNum,
      'Cantidad': 1,
      'Total': totalNum,
      'Tipo': 'PRODUCTO',
      'Facturado Desde': fechaObj,
      'Facturado Hasta': fechaObj,
      'Condicion de Venta': mapCondicionVenta(v.metodo),
      'Condicion de IVA': 'CONSUMIDOR FINAL',
      'CUIT o DNI (Opcional)': '',
      'Email (Opcional)': ''
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    {wch:20},{wch:60},{wch:16},{wch:10},{wch:14},{wch:12},
    {wch:20},{wch:20},{wch:34},{wch:20},{wch:22},{wch:24}
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const mesSel = ($('#mesFiltro').val() || 'mes').replace(/[^0-9\-]/g,'');
  const t=new Date();
  const fname=`Facturacion_OnceyDoce_${mesSel}_${t.getFullYear()}${String(t.getMonth()+1).padStart(2,'0')}${String(t.getDate()).padStart(2,'0')}.xlsx`;
  XLSX.writeFile(wb, fname);
}

// ================== Eventos / Init ==================
$(document).on('input change','#mesFiltro,#buscar,#catFiltro',aplicarFiltros);

// Alcance / rango
$('#alcanceSel').on('change', ()=>{
  const v=$('#alcanceSel').val();
  document.getElementById('rangoWrap').classList.toggle('hidden', v!=='rango');
  renderCharts(); renderExplorer(); renderHoras();
});
$('#btnAplicarRango').on('click', ()=>{ renderCharts(); renderExplorer(); renderHoras(); });
$('#desdeFecha,#hastaFecha,#chkDiaDia').on('change', ()=>{ renderCharts(); renderExplorer(); });

// Tabla: expandir
$('#btnExpandir').on('click',function(){ expandir=!expandir; $(this).text(expandir?'Contraer items':'Expandir items'); renderTabla(); });

// Carga / export
$('#btnReload').on('click',cargarVentas);
$('#btnExcel').on('click', exportarExcel);
$('#btnExcelFact').on('click', exportarExcelFact);

// Día / horario
$('#diaFiltro,#horaDesde,#horaHasta').on('change input', ()=>{ renderKPIs(); renderCharts(); renderCierre(); renderExplorer(); renderHoras(); });
$('#btnHoy').on('click', ()=> setDia(new Date()));
$('#btnAyer').on('click', ()=> { const d=new Date(); d.setDate(d.getDate()-1); setDia(d); });
$('#btnMenos2').on('click', ()=> { const d=new Date(); d.setDate(d.getDate()-2); setDia(d); });

// Explorador
$('#itemCatSel,#itemSortSel,#itemTopN').on('change', renderExplorer);
$('#itemTextSel').on('input', renderExplorer);

// Paginación (delegación)
$(document).on('click', '#paginador button[data-page]', function(){
  const p = parseInt(this.getAttribute('data-page'),10);
  if(!Number.isNaN(p)){ currentPage = p; renderTabla(); }
});

// Panel “Personalizar filtros”
$('#btnConfigFiltros').on('click', openFiltrosPanel);
$('#btnFiltCancelar').on('click', closeFiltrosPanel);
$('#btnFiltGuardar').on('click', saveFiltrosFromPanel);
document.getElementById('panelFiltros')?.addEventListener('click', (e)=>{
  if(e.target.id==='panelFiltros') closeFiltrosPanel();
});

// Init
$(function(){
  applyVisibleFilters();
  cargarVentas();
});
window.addEventListener('resize', ()=>{ if(VENTAS_FILTRADAS.length){ renderCharts(); }});

// ================== Cierre ==================
function ventasDelDiaConHorario(){
  const claveDia = getDiaKeySeleccionado();
  return VENTAS.filter(v => dayKey(v.date) === claveDia && withinHourRange(v.date));
}
function renderCierre(){
  const delDia = ventasDelDiaConHorario();
  const ingresos = delDia.reduce((a,v)=> a + toNumber(v.total), 0);
  const costo    = delDia.reduce((a,v)=> a + toNumber(v.totalCosto), 0);
  const bruta    = ingresos - costo;
  const gastosInput = Number(document.getElementById('cierreGastos').value || 0);
  const personas    = Math.max(1, parseInt(document.getElementById('cierrePersonas').value || '4', 10));
  const neta        = bruta - gastosInput;
  const porPersona  = neta / personas;
  document.getElementById('cierreIng').textContent        = $fmt(ingresos);
  document.getElementById('cierreCosto').textContent      = $fmt(costo);
  document.getElementById('cierreBruta').textContent      = $fmt(bruta);
  document.getElementById('cierreGastosLbl').textContent  = $fmt(gastosInput);
  document.getElementById('cierreNeta').textContent       = $fmt(neta);
  document.getElementById('cierrePorPersona').textContent = $fmt(porPersona);
  const hd = $('#horaDesde').val() || '--:--'; const hh = $('#horaHasta').val() || '--:--';
  const franja = (hd==='--:--' && hh==='--:--') ? '' : ` • ${hd}–${hh}`;
  document.getElementById('cierreRangoLbl').textContent = `Fecha: ${getDiaKeySeleccionado()}${franja}`;
}
$('#cierreGastos,#cierrePersonas').on('change input', renderCierre);
