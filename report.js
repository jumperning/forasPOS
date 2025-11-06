// report_v2.js — Adaptador robusto para CSV publicado de Google Sheets (v2)
// Detección flexible de encabezados, números con coma, BOM, acentos y columnas múltiples de ítems
// URL ejemplo: https://docs.google.com/spreadsheets/d/e/2PACX-1vQTQKDZJ8MOQM-D0qfgBlQqppWs3ilXNHG93CjC8Kjnp0h8Qwkomagzx0mu9bVx_lk5ZsfTBg0OtG8C/pub?output=csv

let RAW_ROWS = [];
let SALES = [];
let PAGE = 1;
const PAGE_SIZE = 25;

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const money = (n) => new Intl.NumberFormat('es-AR', {style:'currency', currency:'ARS', maximumFractionDigits:0}).format(Number(n||0));

// ---- Normalización de encabezados ----
function stripAccents(str){
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function sanitizeKey(k){
  if(k==null) return '';
  let s = String(k).replace(/^\ufeff/, ''); // BOM
  s = stripAccents(s).toLowerCase().trim();
  s = s.replace(/\s+/g,' ');
  s = s.replace(/[$%()\[\]#]/g,'');
  s = s.replace(/[\s\/|-]+/g,'_');
  return s;
}

// Sinonimias (claves ya saneadas)
const headerMap = {
  fecha: ['fecha','fecha_hora','fechahora','timestamp','date','created_at','creado','dia'],
  total: ['total','importe','monto','ingreso','amount','total_$','total_ars'],
  ganancia: ['ganancia','profit','utilidad','margen'],
  costo: ['costo','cost','costo_total'],
  cliente: ['cliente','nombre','buyer','name'],
  mesa: ['mesa','carrito','table','cart'],
  metodo: ['metodo','metodo_de_pago','medio','payment','pago','mp'],
  items: ['items','detalle','productos','lineas','lineas_items','lineas_producto']
};

function findCol(row, key){
  const opts = headerMap[key] || [];
  for(const k of Object.keys(row)){
    const norm = sanitizeKey(k);
    if(opts.includes(norm)) return row[k];
  }
  for(const k of Object.keys(row)){
    const norm = sanitizeKey(k);
    if(opts.some(o => norm.includes(o))) return row[k];
  }
  return undefined;
}

// ---- Parseadores ----
function parseNumberAny(v){
  if(v==null || v==='') return 0;
  if(typeof v === 'number') return v;
  let s = String(v).trim();
  s = s.replace(/[$\s\.]/g,'').replace(/,/g,'.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseDateAny(v){
  if(!v) return null;
  if(v instanceof Date && !isNaN(v)) return v;
  let s = String(v).trim();
  if(/\d{4}-\d{2}-\d{2}/.test(s)){
    const d = new Date(s);
    if(!isNaN(d)) return d;
  }
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(m){
    const dd = parseInt(m[1],10), mm = parseInt(m[2],10)-1, yyyy = parseInt(m[3].length===2 ? ('20'+m[3]) : m[3], 10);
    const hh = m[4]?parseInt(m[4],10):0, mi=m[5]?parseInt(m[5],10):0;
    const d = new Date(yyyy, mm, dd, hh, mi);
    if(!isNaN(d)) return d;
  }
  const d2 = new Date(s);
  return isNaN(d2) ? null : d2;
}

function parseItemsField(v, row){
  if(!v && row){
    const entries = [];
    const keys = Object.keys(row);
    const itemCols = keys.filter(k => /item\d+|producto\d+|articulo\d+/i.test(sanitizeKey(k)));
    if(itemCols.length){
      itemCols.forEach(k =>{
        const idx = sanitizeKey(k).match(/(\d+)/)?.[1];
        const qtyKey = keys.find(z => new RegExp(`(cant|qty|cantidad)${idx}`, 'i').test(sanitizeKey(z)));
        const nombre = String(row[k]||'').trim();
        if(nombre){ entries.push({ nombre, qty: parseNumberAny(qtyKey?row[qtyKey]:1) || 1 }); }
      });
      return entries;
    }
  }
  if(!v) return [];
  if(Array.isArray(v)) return v;
  const s = String(v).trim();
  if(!s) return [];
  if(s.startsWith('[')){
    try{
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.map(x=>({
        nombre: String(x.nombre||x.item||x.producto||'').trim(),
        qty: parseNumberAny(x.qty||x.cantidad||x.unidades||1),
        categoria: x.categoria || x.category
      })) : [];
    }catch{}
  }
  return s.split(/\|/).map(p=>{
    const t=p.trim();
    const m=t.match(/(\d+)\s*[x×]\s*(.*)/i);
    if(m) return { nombre:m[2].trim(), qty: parseNumberAny(m[1])||1 };
    return { nombre:t, qty:1 };
  }).filter(x=>x.nombre);
}

function monthKey(d){ return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : ''; }
function ymd(d){ return d ? d.toISOString().slice(0,10) : ''; }

// ---- Carga CSV ----
async function loadCSV(url){
  return new Promise((resolve, reject)=>{
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => sanitizeKey(h),
      complete: (res)=> resolve(res.data),
      error: (err)=> reject(err)
    });
  });
}

function normalizeRows(rows){
  return rows.map((r)=>{
    const fecha = parseDateAny(findCol(r,'fecha') ?? r.fecha ?? r.fecha_hora ?? r.timestamp);
    const total = parseNumberAny(findCol(r,'total'));
    const costo = parseNumberAny(findCol(r,'costo'));
    let ganancia = findCol(r,'ganancia');
    ganancia = ganancia==null || ganancia==='' ? (total - costo) : parseNumberAny(ganancia);
    const cliente = String(findCol(r,'cliente') ?? r.cliente ?? '').trim();
    const mesa = String(findCol(r,'mesa') ?? r.mesa ?? '').trim();
    const metodo = String(findCol(r,'metodo') ?? r.metodo ?? '').trim();
    const items = parseItemsField(findCol(r,'items'), r);
    return { fecha, total, costo, ganancia, cliente, mesa, metodo, items, _raw: r };
  }).filter(x => x.fecha instanceof Date && !isNaN(x.fecha));
}

// ---- Filtros y KPIs ----
function fillMonthSelect(){
  const sel = $('#mesFiltro'); if(!sel) return;
  sel.innerHTML = '';
  const months = [...new Set(SALES.map(s=>monthKey(s.fecha)))].sort().reverse();
  months.forEach(mk => {
    const [y, m] = mk.split('-');
    const opt = document.createElement('option');
    opt.value = mk; opt.textContent = new Date(Number(y), Number(m)-1, 1).toLocaleDateString('es-AR', {month:'long', year:'numeric'});
    sel.appendChild(opt);
  });
  if(months[0]) sel.value = months[0];
}

function currentFilters(){
  const mk = $('#mesFiltro')?.value || monthKey(new Date());
  const diaSel = $('#diaFiltro')?.value;
  const hDesde = $('#horaDesde')?.value;
  const hHasta = $('#horaHasta')?.value;
  const text = $('#buscar')?.value?.trim().toLowerCase() || '';
  const cat = $('#catFiltro')?.value || '';
  return { mk, diaSel, hDesde, hHasta, text, cat };
}

function matchesText(row, text){
  if(!text) return true;
  const haystack = [row.cliente,row.mesa,row.metodo]
    .concat(row.items.map(i=>i.nombre)).join(' ').toLowerCase();
  return haystack.includes(text);
}

function withinHours(row, diaSel, hDesde, hHasta){
  if(!diaSel) return true;
  const ymdRow = ymd(row.fecha);
  if(ymdRow !== diaSel) return false;
  if(!hDesde && !hHasta) return true;
  const minutes = row.fecha.getHours()*60 + row.fecha.getMinutes();
  const from = hDesde ? (parseInt(hDesde.slice(0,2))*60 + parseInt(hDesde.slice(3,5))) : 0;
  const to   = hHasta ? (parseInt(hHasta.slice(0,2))*60 + parseInt(hHasta.slice(3,5))) : 24*60;
  return minutes >= from && minutes <= to;
}

function dataByMonth(mk){ return SALES.filter(r => monthKey(r.fecha) === mk); }
function sum(arr, fn){ return arr.reduce((a,x)=> a + (fn(x)||0), 0); }
function computeUnits(rows){ return sum(rows, r => r.items.reduce((a,i)=>a + (Number(i.qty)||0), 0)); }

function renderKPIs(){
  const { mk, diaSel, hDesde, hHasta, text } = currentFilters();
  const monthRows = dataByMonth(mk).filter(r => matchesText(r, text));

  $('#kpiVentas').textContent   = monthRows.length.toString();
  $('#kpiUnidades').textContent = computeUnits(monthRows).toString();
  $('#kpiIngresos').textContent = money(sum(monthRows, r=>r.total));

  let dayRows = monthRows;
  if(diaSel){ dayRows = dayRows.filter(r => ymd(r.fecha) === diaSel); }
  dayRows = dayRows.filter(r => withinHours(r, diaSel, hDesde, hHasta));

  const ingDia = sum(dayRows, r=>r.total);
  const cosDia = sum(dayRows, r=>r.costo);
  const ganDia = sum(dayRows, r=>r.ganancia);
  const uniDia = computeUnits(dayRows);

  $('#kpiGanDia').textContent   = money(ganDia);
  $('#kpiIngDia').textContent   = money(ingDia);
  $('#kpiUniDia').textContent   = String(uniDia);
  $('#kpiVentasDia').textContent= String(dayRows.length);
  $('#kpiCostoDia').textContent = money(cosDia);

  $('#cierreIng').textContent      = money(ingDia);
  $('#cierreCosto').textContent    = money(cosDia);
  $('#cierreBruta').textContent    = money(ingDia - cosDia);
  const gastos = Number($('#cierreGastos')?.value || 0);
  $('#cierreGastosLbl').textContent= money(gastos);
  const neta = (ingDia - cosDia) - gastos;
  $('#cierreNeta').textContent     = money(neta);
  const personas = Math.max(1, Number($('#cierrePersonas')?.value || 1));
  $('#cierrePorPersona').textContent = money(neta / personas);
}

function renderTable(){
  const { mk, diaSel, hDesde, hHasta, text } = currentFilters();
  const monthRows = dataByMonth(mk).filter(r => matchesText(r, text));
  const filtered = monthRows.filter(r => withinHours(r, diaSel, hDesde, hHasta));

  const tbody = $('#tbodyVentas');
  tbody.innerHTML = '';

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if(PAGE>totalPages) PAGE = totalPages;
  const slice = filtered.slice((PAGE-1)*PAGE_SIZE, PAGE*PAGE_SIZE);

  slice.forEach(r => {
    const fechaStr = r.fecha.toLocaleString('es-AR', { dateStyle:'short', timeStyle:'short' });
    const itemsStr = r.items.map(i => `${i.qty}× ${i.nombre}`).join(' | ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2">${fechaStr}</td>
      <td class="p-2">${r.cliente||''}</td>
      <td class="p-2">${r.mesa||''}</td>
      <td class="p-2">${r.metodo||''}</td>
      <td class="p-2">${itemsStr}</td>
      <td class="p-2 text-right">${money(r.total)}</td>
      <td class="p-2 text-right">${money(r.ganancia)}</td>`;
    tbody.appendChild(tr);
  });

  const pager = $('#paginador');
  if(pager){
    pager.innerHTML = '';
    const info = document.createElement('div');
    info.textContent = `Mostrando ${slice.length} de ${filtered.length} ventas — Página ${PAGE}/${totalPages}`;
    const controls = document.createElement('div');
    controls.className = 'flex gap-2';
    const btnPrev = document.createElement('button'); btnPrev.className='btn'; btnPrev.textContent='◀ Prev'; btnPrev.disabled = PAGE<=1;
    const btnNext = document.createElement('button'); btnNext.className='btn'; btnNext.textContent='Next ▶'; btnNext.disabled = PAGE>=totalPages;
    btnPrev.onclick=()=>{ PAGE=Math.max(1,PAGE-1); renderTable(); };
    btnNext.onclick=()=>{ PAGE=Math.min(totalPages,PAGE+1); renderTable(); };
    controls.append(btnPrev, btnNext);
    pager.append(info, controls);
  }
}

// ---- Charts: ingresos por hora (si hay día seleccionado) ----
let CHARTS = {};
function destroyCharts(){ Object.values(CHARTS).forEach(c=>{ try{ c.destroy(); }catch{} }); CHARTS={}; }
function maybeRenderCharts(){
  const cvHoras = $('#chartHoras');
  const { mk, diaSel, hDesde, hHasta, text } = currentFilters();
  destroyCharts();
  if(cvHoras && diaSel){
    const rows = dataByMonth(mk).filter(r=> ymd(r.fecha)===diaSel && matchesText(r,text) && withinHours(r, diaSel, hDesde, hHasta));
    const buckets = Array.from({length:24}, (_,h)=>({h, total:0}));
    rows.forEach(r=>{ buckets[r.fecha.getHours()].total += r.total; });
    const labels = buckets.map(b=> String(b.h).padStart(2,'0')+':00');
    const data = buckets.map(b=> b.total);
    if(typeof Chart !== 'undefined'){
      CHARTS.horas = new Chart(cvHoras.getContext('2d'), {
        type:'bar',
        data:{ labels, datasets:[{ label:'Ingresos', data }] },
        options:{ scales:{ y:{ beginAtZero:true } } }
      });
    }
    $('#lblPeakHour').textContent = (Math.max(...data) > 0) ? `Pico: ${labels[data.indexOf(Math.max(...data))]} (${money(Math.max(...data))})` : '';
  }
}

// ---- Diagnóstico visible ----
function showDiag(rows){
  const d = $('#diag'); if(!d) return;
  const first = rows[0] || {};
  const keys = Object.keys(first);
  d.textContent = `Encabezados detectados: ${keys.join(', ')} — Filas: ${rows.length}`;
}

// ---- Bindings ----
function bindUI(){
  $('#btnReload')?.addEventListener('click', initLoad);
  $('#mesFiltro')?.addEventListener('change', ()=>{ PAGE=1; renderKPIs(); renderTable(); maybeRenderCharts(); });
  $('#diaFiltro')?.addEventListener('change', ()=>{ PAGE=1; renderKPIs(); renderTable(); maybeRenderCharts(); });
  $('#horaDesde')?.addEventListener('change', ()=>{ renderKPIs(); renderTable(); maybeRenderCharts(); });
  $('#horaHasta')?.addEventListener('change', ()=>{ renderKPIs(); renderTable(); maybeRenderCharts(); });
  $('#buscar')?.addEventListener('input',  ()=>{ PAGE=1; renderKPIs(); renderTable(); maybeRenderCharts(); });
  $('#catFiltro')?.addEventListener('change', ()=>{ PAGE=1; renderKPIs(); renderTable(); maybeRenderCharts(); });

  $('#btnHoy')?.addEventListener('click', ()=>{ $('#diaFiltro').value = new Date().toISOString().slice(0,10); renderKPIs(); renderTable(); maybeRenderCharts(); });
  $('#btnAyer')?.addEventListener('click', ()=>{ const d=new Date(); d.setDate(d.getDate()-1); $('#diaFiltro').value = d.toISOString().slice(0,10); renderKPIs(); renderTable(); maybeRenderCharts(); });
  $('#btnMenos2')?.addEventListener('click', ()=>{ const d=new Date(); d.setDate(d.getDate()-2); $('#diaFiltro').value = d.toISOString().slice(0,10); renderKPIs(); renderTable(); maybeRenderCharts(); });

  $('#cierreGastos')?.addEventListener('input', ()=>{ renderKPIs(); });
  $('#cierrePersonas')?.addEventListener('input', ()=>{ renderKPIs(); });

  $('#btnToggleMoneda')?.addEventListener('click', ()=>{
    $$('.money').forEach(el=>{
      const curr = el.getAttribute('data-hidden') === '1';
      if(curr){ el.textContent = el.getAttribute('data-value')||el.textContent; el.setAttribute('data-hidden','0'); }
      else{ el.setAttribute('data-value', el.textContent); el.textContent = '***'; el.setAttribute('data-hidden','1'); }
    });
  });

  $('#btnConfigFiltros')?.addEventListener('click', ()=> $('#panelFiltros')?.classList.remove('hidden'));
  $('#btnFiltCancelar')?.addEventListener('click', ()=> $('#panelFiltros')?.classList.add('hidden'));
  $('#btnFiltGuardar')?.addEventListener('click', ()=> $('#panelFiltros')?.classList.add('hidden'));
}

// ---- Init ----
async function initLoad(){
  const status = $('#statusBadge');
  const diag = $('#diag');
  const url = $('#csvUrl')?.value?.trim();
  if(!url){ alert('Pegá la URL del CSV publicado de Google Sheets'); return; }
  try{
    status && (status.textContent = 'Descargando CSV…');
    diag && (diag.textContent = 'Cargando datos desde: '+url);
    const rows = await loadCSV(url);
    RAW_ROWS = rows;
    showDiag(rows);

    SALES = normalizeRows(rows).sort((a,b)=> a.fecha - b.fecha);
    if(SALES.length===0){
      const sample = rows[0] || {};
      const keys = Object.keys(sample).join(', ');
      throw new Error('No se encontraron filas válidas. Encabezados detectados: '+ keys + '. Verificá que exista una columna de FECHA y otra de TOTAL.');
    }

    fillMonthSelect();
    renderKPIs();
    PAGE=1; renderTable();
    maybeRenderCharts();

    status && (status.textContent = 'Datos sincronizados');
  }catch(err){
    console.error(err);
    diag && (diag.textContent = 'Error: '+ (err?.message||err));
    status && (status.textContent = 'Error');
    alert('No pude cargar el CSV: '+ (err?.message||err));
  }
}

window.addEventListener('DOMContentLoaded', ()=>{
  const csvInput = $('#csvUrl');
  if(csvInput && !csvInput.value){
    csvInput.value = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQTQKDZJ8MOQM-D0qfgBlQqppWs3ilXNHG93CjC8Kjnp0h8Qwkomagzx0mu9bVx_lk5ZsfTBg0OtG8C/pub?output=csv';
  }
  bindUI();
  initLoad();
});
