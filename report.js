// report.js — Lee un CSV publicado de Google Sheets y alimenta el Reporte
// URL de ejemplo (la que me pasaste):
// https://docs.google.com/spreadsheets/d/e/2PACX-1vQTQKDZJ8MOQM-D0qfgBlQqppWs3ilXNHG93CjC8Kjnp0h8Qwkomagzx0mu9bVx_lk5ZsfTBg0OtG8C/pub?output=csv

/*
  === Qué hace este archivo ===
  - Descarga el CSV publicado (con Papa.parse) desde el input #csvUrl
  - Normaliza filas (fecha, total, costo, ganancia, items, cliente, mesa, método)
  - Rellena filtros de mes / día y KPIs mensuales y diarios
  - Pinta la tabla de ventas y hace paginación simple
  - Deja hooks listos para los charts y el análisis por categoría (si hay data de categorías)

  Está preparado para CSVs con encabezados en español/inglés y variantes como:
  "fecha", "timestamp", "date";
  "total", "monto", "ingreso";
  "ganancia", "profit";
  "costo", "cost";
  "cliente", "nombre";
  "mesa", "carrito";
  "metodo", "método", "pago", "payment";
  "items" (acepta JSON o texto tipo: "2x Hamburguesa | 1x Coca")
*/

// ---------- Estado global ----------
let RAW_ROWS = [];   // filas crudas del CSV (objetos por encabezado)
let SALES = [];      // filas normalizadas {fecha: Date, total: number, costo, ganancia, cliente, mesa, metodo, items: [{nombre, qty, categoria?}]}

// UI / paginación
let PAGE = 1;
const PAGE_SIZE = 25;

// ---------- Utils ----------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const money = (n) => new Intl.NumberFormat('es-AR', {style:'currency', currency:'ARS', maximumFractionDigits:0}).format(Number(n||0));
const int = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

const headerMap = {
  fecha: ['fecha','timestamp','date','fechahora','fecha_hora','created_at'],
  total: ['total','monto','ingreso','importe','amount'],
  ganancia: ['ganancia','profit','utilidad'],
  costo: ['costo','cost'],
  cliente: ['cliente','nombre','buyer','name'],
  mesa: ['mesa','carrito','table','cart'],
  metodo: ['metodo','método','payment','pago','mp','medio'],
  items: ['items','detalle','products','lineas','líneas']
};

function findCol(row, key){
  const opts = headerMap[key] || [];
  // buscar primera coincidencia de clave existente (case-insensitive)
  for(const k of Object.keys(row)){
    const norm = String(k).trim().toLowerCase();
    if(opts.includes(norm)) return row[k];
  }
  // fallback por coincidencia difusa
  for(const k of Object.keys(row)){
    const norm = String(k).trim().toLowerCase();
    if(opts.some(o => norm.includes(o))) return row[k];
  }
  return undefined;
}

function parseDateAny(v){
  if(!v) return null;
  if(v instanceof Date) return v;
  // soportar ISO, dd/mm/yyyy hh:mm, yyyy-mm-dd, etc.
  let s = String(v).trim();
  // Reemplazar 'T' y normalizar
  if(/\d{4}-\d{2}-\d{2}/.test(s)){
    const d = new Date(s);
    if(!isNaN(d)) return d;
  }
  // dd/mm/yyyy [hh:mm]
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

function parseItemsField(v){
  if(!v) return [];
  if(Array.isArray(v)) return v;
  // si viene JSON
  if(typeof v === 'string' && v.trim().startsWith('[')){
    try{
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? arr.map(x=>({
        nombre: String(x.nombre||x.item||x.producto||'').trim(),
        qty: int(x.qty||x.cantidad||x.unidades||1),
        categoria: x.categoria || x.category
      })) : [];
    }catch{}
  }
  // si viene texto tipo "2x Hamburguesa | 1x Coca"
  const parts = String(v).split(/\|/);
  return parts.map(p => {
    const t = p.trim();
    const m = t.match(/(\d+)\s*[x×]\s*(.*)/i);
    if(m){ return { nombre: m[2].trim(), qty: int(m[1])||1 }; }
    return { nombre: t, qty: 1 };
  }).filter(x => x.nombre);
}

function monthKey(d){ return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` : ''; }
function ymd(d){ return d ? d.toISOString().slice(0,10) : ''; }

// ---------- Carga CSV ----------
async function loadCSV(url){
  return new Promise((resolve, reject)=>{
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res)=> resolve(res.data),
      error: (err)=> reject(err)
    });
  });
}

function normalizeRows(rows){
  return rows.map((r)=>{
    const fecha = parseDateAny(findCol(r,'fecha'));
    const total = int(findCol(r,'total'));
    const costo = int(findCol(r,'costo'));
    let ganancia = findCol(r,'ganancia');
    ganancia = ganancia==null || ganancia==='' ? (total - costo) : int(ganancia);
    const cliente = String(findCol(r,'cliente')||'').trim();
    const mesa = String(findCol(r,'mesa')||'').trim();
    const metodo = String(findCol(r,'metodo')||'').trim();
    const items = parseItemsField(findCol(r,'items'));
    return { fecha, total, costo, ganancia, cliente, mesa, metodo, items, _raw: r };
  }).filter(x => x.fecha instanceof Date && !isNaN(x.fecha));
}

// ---------- KPIs & Render ----------
function fillMonthSelect(){
  const sel = $('#mesFiltro');
  if(!sel) return;
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
  const diaSel = $('#diaFiltro')?.value; // yyyy-mm-dd o ''
  const hDesde = $('#horaDesde')?.value; // HH:MM
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
  if(!diaSel) return true; // sin día => ignoro hora
  const ymdRow = ymd(row.fecha);
  if(ymdRow !== diaSel) return false;
  if(!hDesde && !hHasta) return true;
  const minutes = row.fecha.getHours()*60 + row.fecha.getMinutes();
  const from = hDesde ? (parseInt(hDesde.slice(0,2))*60 + parseInt(hDesde.slice(3,5))) : 0;
  const to   = hHasta ? (parseInt(hHasta.slice(0,2))*60 + parseInt(hHasta.slice(3,5))) : 24*60;
  return minutes >= from && minutes <= to;
}

function dataByMonth(mk){
  return SALES.filter(r => monthKey(r.fecha) === mk);
}

function sum(arr, fn){ return arr.reduce((a,x)=> a + (fn(x)||0), 0); }

function computeUnits(rows){
  return sum(rows, r => r.items.reduce((a,i)=>a + int(i.qty), 0));
}

function renderKPIs(){
  const { mk, diaSel, hDesde, hHasta, text } = currentFilters();
  const monthRows = dataByMonth(mk).filter(r => matchesText(r, text));

  // Mensuales
  $('#kpiVentas').textContent   = monthRows.length.toString();
  $('#kpiUnidades').textContent = computeUnits(monthRows).toString();
  $('#kpiIngresos').textContent = money(sum(monthRows, r=>r.total));

  // Día
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

  // Rango cierre (usa el día si lo hay)
  $('#cierreIng').textContent      = money(ingDia);
  $('#cierreCosto').textContent    = money(cosDia);
  $('#cierreBruta').textContent    = money(ingDia - cosDia);
  const gastos = int($('#cierreGastos')?.value || 0);
  $('#cierreGastosLbl').textContent= money(gastos);
  const neta = (ingDia - cosDia) - gastos;
  $('#cierreNeta').textContent     = money(neta);
  const personas = Math.max(1, int($('#cierrePersonas')?.value || 1));
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

  // paginador
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

// ---------- Charts (opcionales, se renderizan si hay <canvas>) ----------
let CHARTS = {};
function destroyCharts(){ Object.values(CHARTS).forEach(c=>{ try{ c.destroy(); }catch{} }); CHARTS={}; }

function maybeRenderCharts(){
  // Por ahora armamos un gráfico simple de Ingresos por hora del día seleccionado
  const cvHoras = $('#chartHoras');
  const { mk, diaSel, hDesde, hHasta, text } = currentFilters();
  destroyCharts();
  if(cvHoras && diaSel){
    const rows = dataByMonth(mk).filter(r=> ymd(r.fecha)===diaSel && matchesText(r,text) && withinHours(r, diaSel, hDesde, hHasta));
    const buckets = Array.from({length:24}, (_,h)=>({h, total:0}));
    rows.forEach(r=>{ buckets[r.fecha.getHours()].total += r.total; });
    const labels = buckets.map(b=> String(b.h).padStart(2,'0')+':00');
    const data = buckets.map(b=> b.total);
    CHARTS.horas = new Chart(cvHoras.getContext('2d'), {
      type:'bar',
      data:{ labels, datasets:[{ label:'Ingresos', data }] },
      options:{ scales:{ y:{ beginAtZero:true } } }
    });
    const maxIdx = data.indexOf(Math.max(...data));
    $('#lblPeakHour').textContent = maxIdx>=0 ? `Pico: ${labels[maxIdx]} (${money(data[maxIdx])})` : '';
  }

  // TODO: si en tus filas / items viene categoría, acá podemos armar pie/barras por categoría
}

// ---------- Bindings ----------
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

  // Mostrar/ocultar montos (simple: agrega/remueve clase money con *** si se quiere)
  $('#btnToggleMoneda')?.addEventListener('click', ()=>{
    $$('.money').forEach(el=>{
      const curr = el.getAttribute('data-hidden') === '1';
      if(curr){ el.textContent = el.getAttribute('data-value')||el.textContent; el.setAttribute('data-hidden','0'); }
      else{ el.setAttribute('data-value', el.textContent); el.textContent = '***'; el.setAttribute('data-hidden','1'); }
    });
  });

  // Panel de filtros (opcional)
  $('#btnConfigFiltros')?.addEventListener('click', ()=> $('#panelFiltros')?.classList.remove('hidden'));
  $('#btnFiltCancelar')?.addEventListener('click', ()=> $('#panelFiltros')?.classList.add('hidden'));
  $('#btnFiltGuardar')?.addEventListener('click', ()=> $('#panelFiltros')?.classList.add('hidden'));
}

// ---------- Init principal ----------
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
    SALES = normalizeRows(rows).sort((a,b)=> a.fecha - b.fecha);
    if(SALES.length===0) throw new Error('No se encontraron filas válidas. Verificá los encabezados.');

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

// Auto-init al cargar la página
window.addEventListener('DOMContentLoaded', ()=>{
  // Si el input viene vacío, seteo la URL que me pasaste como predeterminada
  const csvInput = $('#csvUrl');
  if(csvInput && !csvInput.value){
    csvInput.value = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQTQKDZJ8MOQM-D0qfgBlQqppWs3ilXNHG93CjC8Kjnp0h8Qwkomagzx0mu9bVx_lk5ZsfTBg0OtG8C/pub?output=csv';
  }
  bindUI();
  initLoad();
});
