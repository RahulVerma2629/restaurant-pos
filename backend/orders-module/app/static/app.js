'use strict';
/* Restaurant POS — Order & Front-of-House UI (plain JavaScript, no build step).
   Screens: Floor/Dine-in · Order screen · Kitchen (KDS) · Takeaway & Delivery.  API: /api/v1 */
const API = '/api/v1';
const BRANCH = 1;
let user = { id: 'waiter-1', role: 'waiter' };

const S = {
  tab: 'floor', tables: [], mode: 'open', source: null,
  orderId: null, order: null, history: null, menu: [], cats: [], cat: null, orderable: new Set(), priority: 'normal',
  kots: [], station: '', others: [], form: { type: 'takeaway', name: '', phone: '', address: '', platform: '' },
  dialog: null, lastEvent: -1,
};

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupees = (p) => '₹' + (p / 100).toFixed(2);
const label = (s) => String(s).replace(/_/g, ' ');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));
const ts = (s) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z'); // server sends naive UTC
const minutesSince = (s) => (s ? Math.max(0, Math.floor((Date.now() - ts(s).getTime()) / 60000)) : 0);
const qs = (o) => { const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => k + '=' + encodeURIComponent(v)); return p.length ? '?' + p.join('&') : ''; };
const typing = () => ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);

async function req(method, path, body, headers = {}) {
  const res = await fetch(API + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-User-Id': user.id, 'X-User-Role': user.role, ...headers },
  });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const e = new Error(data?.error?.message || res.statusText); e.code = data?.error?.code; throw e; }
  return data;
}
function toast(msg) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; $('#toasts').append(d); setTimeout(() => d.remove(), 4500); }
async function safe(fn) { try { return await fn(); } catch (e) { toast(e.message || 'Something went wrong'); } }

// ---------- data ----------
async function load() {
  if (S.tab === 'floor') S.tables = await req('GET', '/tables' + qs({ branch_id: BRANCH }));
  if (S.tab === 'kitchen') S.kots = await req('GET', '/kot' + qs({ branch_id: BRANCH, station: S.station, active_only: true }));
  if (S.tab === 'orders') {
    const [a, b] = await Promise.all([req('GET', '/orders' + qs({ branch_id: BRANCH, order_type: 'takeaway' })), req('GET', '/orders' + qs({ branch_id: BRANCH, order_type: 'delivery' }))]);
    S.others = [...a, ...b].filter((o) => !['closed', 'cancelled', 'rejected', 'refunded'].includes(o.status)).sort((x, y) => y.id - x.id);
  }
  if (S.orderId) {
    const [o, av] = await Promise.all([req('GET', '/orders/' + S.orderId), req('GET', '/menu/available' + qs({ branch_id: BRANCH }))]);
    S.order = o; S.orderable = new Set(av.map((i) => i.id));
    if (!S.menu.length) { [S.menu, S.cats] = await Promise.all([req('GET', '/menu/items'), req('GET', '/menu/categories')]); S.cat = S.cats[0]?.id ?? null; }
  }
}
async function refresh() { try { await load(); } catch (e) { toast(e.message); } render(); }

// ---------- views ----------
const TLABEL = { available: 'Available', reserved: 'Reserved', occupied: 'Occupied', ordering: 'Ordering', preparing: 'Preparing', waiting_payment: 'Waiting for payment', payment_completed: 'Payment done', cleaning: 'Cleaning', blocked: 'Blocked' };
const STATIONS = ['', 'Main Kitchen', 'Grill', 'Bakery', 'Beverage', 'Dessert'];

function viewFloor() {
  const floors = [...new Set(S.tables.map((t) => t.floor))];
  const hint = S.mode === 'move' ? (S.source ? `Move ${S.source.number} → tap an AVAILABLE table` : 'Tap the table whose order you want to move')
    : S.mode === 'merge' ? (S.source ? `Merge into ${S.source.number} → tap the table to merge` : 'Tap the PRIMARY table (it keeps the order)') : '';
  return `<div class="toolbar">${[['open', 'Open / New order'], ['move', 'Move table'], ['merge', 'Merge tables'], ['block', 'Block / Release']]
    .map(([m, l]) => `<button class="chip ${S.mode === m ? 'active' : ''}" data-a="mode" data-v="${m}">${l}</button>`).join('')}${hint ? `<span class="hint">${hint}</span>` : ''}</div>
  <div class="legend">${Object.entries(TLABEL).map(([k, v]) => `<span class="dot s-${k}">${v}</span>`).join('')}</div>
  ${floors.map((f) => `<h3>${esc(f)} floor</h3><div class="tables">${S.tables.filter((t) => t.floor === f).map((t) =>
    `<button class="table s-${t.status} ${S.source?.id === t.id ? 'picked' : ''}" data-a="table" data-id="${t.id}"><b>${esc(t.number)}</b><small>${TLABEL[t.status]}</small><small>${t.guests ? t.guests + ' guests · ' : ''}seats ${t.capacity}</small></button>`).join('')}</div>`).join('')}
  ${S.tables.length ? '' : '<p class="muted">No tables yet.</p>'}`;
}

function viewKitchen() {
  const cols = [['New', ['pending', 'sent', 'failed']], ['Cooking', ['accepted', 'preparing']]];
  return `<div class="toolbar">${STATIONS.map((s) => `<button class="chip ${S.station === s ? 'active' : ''}" data-a="station" data-v="${esc(s)}">${s || 'All stations'}</button>`).join('')}
    <span class="hint">${S.kots.filter((k) => k.delayed).length} delayed</span></div>
  <div class="kds">${cols.map(([title, sts]) => { const list = S.kots.filter((k) => sts.includes(k.status));
    return `<div class="kds-col"><h3>${title} <small>(${list.length})</small></h3>${list.map((k) => `
    <div class="ticket p-${k.priority} ${k.delayed ? 'delayed' : ''} ${k.type === 'CANCEL' ? 'cancel' : ''}">
      <div class="ticket-head"><b>${esc(k.kot_no)}</b><span>order #${k.order_id}</span><span>${esc(k.station)}</span>
        ${k.type !== 'NEW' ? `<span class="pill kt-${k.type}">${k.type}</span>` : ''}${k.priority !== 'normal' ? `<span class="pill pr">${k.priority.toUpperCase()}</span>` : ''}
        ${k.delayed ? '<span class="pill bad-pill">DELAYED</span>' : ''}<small>${minutesSince(k.sent_at || k.created_at)} min</small></div>
      ${k.items.map((i) => `<div class="kline ${i.status === 'cancelled' ? 'struck' : ''}"><b>${i.qty}× ${esc(i.name)}</b>${i.modifiers ? `<small>${esc(i.modifiers)}</small>` : ''}${i.note ? `<small>📝 ${esc(i.note)}</small>` : ''}</div>`).join('')}
      <div class="actions">
        ${k.status === 'failed' ? `<button class="danger" data-a="kretry" data-id="${k.id}">Print failed — retry</button>` : ''}
        ${k.status === 'sent' ? `<button class="chip" data-a="kstatus" data-id="${k.id}" data-v="accepted">Accept</button>` : ''}
        ${['sent', 'accepted'].includes(k.status) ? `<button class="primary" data-a="kstatus" data-id="${k.id}" data-v="preparing">Start</button>` : ''}
        ${k.status === 'preparing' ? `<button class="primary" data-a="kstatus" data-id="${k.id}" data-v="ready">Ready ✓</button>` : ''}
      </div></div>`).join('')}</div>`; }).join('')}</div>`;
}

function viewOrders() {
  const f = S.form;
  return `<div class="panel"><div class="toolbar">${['takeaway', 'delivery'].map((t) => `<button class="chip ${f.type === t ? 'active' : ''}" data-a="ftype" data-v="${t}">New ${t}</button>`).join('')}</div>
  <div class="form">
    <input placeholder="Customer name" data-f="name" value="${esc(f.name)}"><input placeholder="Phone" data-f="phone" value="${esc(f.phone)}">
    ${f.type === 'delivery' ? `<input placeholder="Delivery address" data-f="address" value="${esc(f.address)}"><input placeholder="Platform (Zomato / Swiggy / website — optional)" data-f="platform" value="${esc(f.platform)}">` : ''}
    <button class="primary" data-a="createOther">Create order</button></div></div>
  <h3>Active takeaway & delivery orders</h3>${S.others.length ? '' : '<p class="muted">Nothing active.</p>'}
  <div class="rows">${S.others.map((o) => { const d = o.delivery; return `<div class="row"><div>
    <b>${esc(o.order_no)}</b> <span class="pill">${o.order_type}</span> <span class="pill st-${o.status}">${label(o.status)}</span>
    ${d ? `<span class="pill">delivery: ${d.status}${d.rider ? ' (' + esc(d.rider) + ')' : ''}</span>` : ''}
    <div class="muted">${esc(o.customer_name || '—')} · ${esc(o.customer_phone || '')} ${d?.address ? '· ' + esc(d.address) : ''} · ${rupees(o.subtotal)}</div></div>
    <div class="actions"><button class="chip" data-a="open" data-id="${o.id}">Open</button>
      ${o.order_type === 'takeaway' && o.status === 'ready' ? `<button class="primary" data-a="handover" data-id="${o.id}">Handover</button>` : ''}
      ${d?.status === 'pending' && o.status === 'ready' ? `<button class="primary" data-a="dly" data-id="${o.id}" data-v="assign">Assign rider</button>` : ''}
      ${d?.status === 'assigned' ? `<button class="primary" data-a="dly" data-id="${o.id}" data-v="dispatch">Dispatch</button>` : ''}
      ${d?.status === 'dispatched' ? `<button class="primary" data-a="dly" data-id="${o.id}" data-v="complete">Delivered</button><button class="danger" data-a="dly" data-id="${o.id}" data-v="fail">Failed</button>` : ''}
      ${d && o.payment_status === 'unpaid' ? `<button class="chip" data-a="codpaid" data-id="${o.id}">Mark paid / COD</button>` : ''}
      ${o.status === 'served' ? `<button class="chip" data-a="ostatus" data-id="${o.id}" data-v="billed">Bill</button>` : ''}
      ${o.status === 'billed' ? `<button class="chip" data-a="ostatus" data-id="${o.id}" data-v="paid">Paid</button>` : ''}
      ${o.status === 'paid' ? `<button class="chip" data-a="ostatus" data-id="${o.id}" data-v="closed">Close</button>` : ''}
    </div></div>`; }).join('')}</div>`;
}

function viewOrder() {
  const o = S.order;
  const live = o.items.filter((i) => i.status !== 'cancelled');
  const pending = live.filter((i) => i.status === 'pending');
  const ready = live.filter((i) => i.status === 'ready');
  const done = ['cancelled', 'rejected', 'closed', 'refunded'].includes(o.status);
  const canAdd = !done && !['billed', 'paid'].includes(o.status);
  const shown = S.menu.filter((m) => S.cat === null || m.category_id === S.cat);
  return `<div class="modal"><div class="sheet">
  <div class="sheet-head"><div><h2>Order ${esc(o.order_no)}</h2><span class="pill st-${o.status}">${label(o.status)}</span>
    <span class="muted"> ${label(o.order_type)}${o.table_id ? ' · table #' + o.table_id : ''}${o.customer_name ? ' · ' + esc(o.customer_name) : ''}</span></div>
    <button class="chip" data-a="closeOrder">Close ✕</button></div>
  <div class="cols"><div class="menu">
    <div class="toolbar">${S.cats.map((c) => `<button class="chip ${S.cat === c.id ? 'active' : ''}" data-a="cat" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
    <div class="grid">${shown.map((m) => { const ok = S.orderable.has(m.id); return `<button class="card ${ok ? '' : 'off'}" data-a="menu" data-id="${m.id}" ${canAdd ? '' : 'disabled'}>
      <b>${esc(m.name)}</b><span>${rupees(m.price)}</span><small>${esc(m.station)} · ${m.prep_time_min}m${m.modifier_groups.length ? ' · options' : ''}</small>${ok ? '' : '<small class="bad">Unavailable</small>'}</button>`; }).join('')}</div>
  </div><aside class="cart"><h3>Items</h3>${live.length ? '' : '<p class="muted">No items yet — tap the menu.</p>'}
    ${live.map((i) => `<div class="line"><div class="line-main"><b>${i.qty}× ${esc(i.name)}</b><span>${rupees(i.line_total)}</span></div>
      ${i.modifiers.map((m) => `<small class="mod">+ ${esc(m.name)}${m.price ? ' (' + rupees(m.price) + ')' : ''}</small>`).join('')}${i.note ? `<small class="mod">📝 ${esc(i.note)}</small>` : ''}
      <div class="line-actions"><span class="pill it-${i.status}">${i.status}</span>
        ${i.status === 'pending' ? `<button class="mini" data-a="qty" data-id="${i.id}" data-q="${Math.max(1, i.qty - 1)}">−</button><button class="mini" data-a="qty" data-id="${i.id}" data-q="${i.qty + 1}">+</button>` : ''}
        ${i.status !== 'served' && !done ? `<button class="mini danger" data-a="rm" data-id="${i.id}">✕</button>` : ''}</div></div>`).join('')}
    <div class="total"><span>Subtotal</span><b>${rupees(o.subtotal)}</b></div><small class="muted">Tax & discounts are applied by the Billing module.</small>
    <button class="chip block" data-a="note">📝 ${o.note ? 'Note: ' + esc(o.note) : 'Add order note'}</button>
    ${done ? '' : `<div class="actions">
      ${pending.length || o.status === 'modified' ? `<select data-c="priority">${['normal', 'high', 'rush'].map((p) => `<option ${S.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
        <button class="primary" data-a="confirm">Send to kitchen (KOT)${pending.length ? ' · ' + pending.length + ' new' : ''}</button>` : ''}
      ${ready.length && o.order_type === 'dine_in' ? `<button class="primary" data-a="serve">Serve ${ready.length} ready item(s)</button>` : ''}
      ${o.order_type === 'takeaway' && o.status === 'ready' ? '<button class="primary" data-a="handoverOrder">Hand over to customer</button>' : ''}
      ${o.status === 'served' ? '<button class="primary" data-a="ostatusOrder" data-v="billed">Request bill</button>' : ''}
      ${o.status === 'billed' ? '<button class="primary" data-a="ostatusOrder" data-v="paid">Mark paid <small>(demo – Billing module)</small></button>' : ''}
      ${o.status === 'paid' ? '<button class="primary" data-a="ostatusOrder" data-v="closed">Close order</button>' : ''}
      ${['created', 'confirmed', 'kot_sent', 'preparing', 'modified'].includes(o.status) ? '<button class="danger" data-a="cancelOrder">Cancel order</button>' : ''}</div>`}
    <button class="chip block" data-a="history">${S.history ? 'Hide' : 'Show'} status history</button>
    ${S.history ? `<ol class="history">${S.history.map((h) => `<li><b>${h.new_status}</b> <small>${ts(h.at).toLocaleTimeString()} · ${esc(h.changed_by)}${h.reason ? ' · ' + esc(h.reason) : ''}</small></li>`).join('')}</ol>` : ''}
  </aside></div></div></div>`;
}

function viewDialog() {
  const D = S.dialog; if (!D) return '';
  const it = D.item, sel = D.sel;
  const count = (g) => g.modifiers.reduce((s, m) => s + (sel[m.id] || 0), 0);
  const problems = it.modifier_groups.flatMap((g) => { const n = count(g), min = Math.max(g.min_select, g.required ? 1 : 0);
    return n < min ? [`Choose at least ${min} in ${g.name}`] : n > g.max_select ? [`Choose at most ${g.max_select} in ${g.name}`] : []; });
  const extra = it.modifier_groups.flatMap((g) => g.modifiers).reduce((s, m) => s + (sel[m.id] || 0) * m.extra_price, 0);
  D.problems = problems;
  return `<div class="modal inner"><div class="sheet small"><h3>${esc(it.name)} <small>${rupees(it.price)}</small></h3>
  ${it.modifier_groups.map((g) => `<div class="group"><b>${esc(g.name)}</b> <small class="muted">${g.required ? 'required · ' : ''}max ${g.max_select}</small>
    <div class="toolbar">${g.modifiers.map((m) => `<button class="chip ${sel[m.id] ? 'active' : ''}" ${m.is_available ? '' : 'disabled'} data-a="dmod" data-id="${m.id}">${esc(m.name)}${m.extra_price ? ' +' + rupees(m.extra_price) : ''}</button>`).join('')}</div></div>`).join('')}
  <input placeholder="Customer note (e.g. less spicy)" data-d="note" value="${esc(D.note)}">
  <div class="toolbar"><button class="mini" data-a="dqty" data-v="-1">−</button><b>${D.qty}</b><button class="mini" data-a="dqty" data-v="1">+</button></div>
  ${problems.map((p) => `<small class="bad">${esc(p)}</small>`).join('')}
  <div class="actions"><button class="chip" data-a="dcancel">Cancel</button><button class="primary" data-a="dadd" ${problems.length ? 'disabled' : ''}>Add · ${rupees((it.price + extra) * D.qty)}</button></div></div></div>`;
}

function render() {
  const tabs = [['floor', 'Floor / Dine-in'], ['orders', 'Takeaway & Delivery'], ['kitchen', 'Kitchen (KDS)']];
  $('#nav').innerHTML = tabs.map(([k, l]) => `<button class="tab ${S.tab === k ? 'active' : ''}" data-a="tab" data-v="${k}">${l}</button>`).join('');
  $('#main').innerHTML = S.tab === 'floor' ? viewFloor() : S.tab === 'orders' ? viewOrders() : viewKitchen();
  $('#modal').innerHTML = S.orderId && S.order ? viewOrder() : S.orderId ? '<div class="modal"><div class="sheet">Loading…</div></div>' : '';
}
const renderDialog = () => { $('#dialog').innerHTML = viewDialog(); };

// ---------- actions ----------
const act = async (fn) => { const o = await safe(fn); if (o) { S.order = o; render(); } };
const oid = () => S.order.id;
function openOrder(id) { S.orderId = id; S.order = null; S.history = null; render(); refresh(); }
const A = {
  tab: (d) => { S.tab = d.v; S.source = null; refresh(); },
  mode: (d) => { S.mode = d.v; S.source = null; render(); },
  station: (d) => { S.station = d.v; refresh(); },
  open: (d) => openOrder(Number(d.id)),
  closeOrder: () => { S.orderId = null; S.order = null; refresh(); },
  cat: (d) => { S.cat = Number(d.id); render(); },

  async table(d) {
    const t = S.tables.find((x) => x.id == d.id);
    if (S.mode === 'open') {
      if (t.current_order_id) return openOrder(t.current_order_id);
      if (t.status === 'cleaning') { if (confirm(`Table ${t.number} cleaned? Mark available`)) await safe(() => req('PATCH', `/tables/${t.id}/status`, { status: 'available' })); return refresh(); }
      if (t.status === 'blocked') return toast(`Table ${t.number} is blocked: ${t.block_reason}`);
      const g = Number(prompt(`Guests for table ${t.number}?`, Math.min(2, t.capacity))); if (!g) return;
      const o = await safe(() => req('POST', '/orders', { branch_id: BRANCH, order_type: 'dine_in', table_id: t.id, guests: g }, { 'Idempotency-Key': uuid() }));
      if (o) openOrder(o.id);
    } else if (S.mode === 'block') {
      if (t.status === 'blocked') await safe(() => req('PATCH', `/tables/${t.id}/status`, { status: 'available' }));
      else { const reason = prompt(`Reason to block table ${t.number}?`); if (reason) await safe(() => req('PATCH', `/tables/${t.id}/status`, { status: 'blocked', reason })); }
      refresh();
    } else {
      if (!S.source) { if (!t.current_order_id) return toast('Pick a table that has an active order'); S.source = t; return render(); }
      if (S.source.id === t.id) { S.source = null; return render(); }
      const ok = S.mode === 'move' ? await safe(() => req('POST', `/tables/${S.source.id}/transfer`, { to_table_id: t.id }))
        : await safe(() => req('POST', '/tables/merge', { primary_table_id: S.source.id, secondary_table_id: t.id }));
      if (ok) toast(S.mode === 'move' ? `Order moved to ${t.number}` : `Tables ${S.source.number} + ${t.number} merged`);
      S.source = null; refresh();
    }
  },

  menu(d) {
    const m = S.menu.find((x) => x.id == d.id);
    if (!S.orderable.has(m.id)) return alert(`${m.name} is not available right now`);
    if (m.modifier_groups.length) { S.dialog = { item: m, sel: {}, qty: 1, note: '' }; return renderDialog(); }
    act(() => req('POST', `/orders/${oid()}/items`, { menu_item_id: m.id, qty: 1 }, { 'If-Match': String(S.order.version) }));
  },
  dmod: (d) => { S.dialog.sel[d.id] = S.dialog.sel[d.id] ? 0 : 1; renderDialog(); },
  dqty: (d) => { S.dialog.qty = Math.max(1, S.dialog.qty + Number(d.v)); renderDialog(); },
  dcancel: () => { S.dialog = null; renderDialog(); },
  dadd() {
    const D = S.dialog; if (D.problems.length) return;
    const modifiers = Object.entries(D.sel).filter(([, q]) => q > 0).map(([id, q]) => ({ modifier_id: Number(id), qty: q }));
    const body = { menu_item_id: D.item.id, qty: D.qty, modifiers, note: D.note || undefined };
    S.dialog = null; renderDialog();
    act(() => req('POST', `/orders/${oid()}/items`, body, { 'If-Match': String(S.order.version) }));
  },

  qty: (d) => act(() => req('PATCH', `/orders/${oid()}/items/${d.id}`, { qty: Number(d.q) })),
  rm(d) {
    const i = S.order.items.find((x) => x.id == d.id);
    if (i.status === 'pending') return act(() => req('DELETE', `/orders/${oid()}/items/${i.id}`));
    const reason = prompt(`Remove "${i.name}" — already sent to kitchen. Reason?`); if (!reason) return;
    const approved_by = prompt('Manager name for approval (leave empty if you are the manager)') || undefined;
    act(() => req('DELETE', `/orders/${oid()}/items/${i.id}` + qs({ reason, approved_by })));
  },
  note() { const n = prompt('Order note for kitchen / waiter', S.order.note || ''); if (n !== null) act(() => req('POST', `/orders/${oid()}/notes`, { note: n })); },
  confirm: () => act(() => req('POST', `/orders/${oid()}/confirm`, { priority: S.priority })),
  serve: () => act(() => req('POST', `/orders/${oid()}/serve`, {})),
  handoverOrder: () => act(() => req('POST', `/orders/${oid()}/handover`)),
  ostatusOrder: (d) => act(() => req('POST', `/orders/${oid()}/status`, { status: d.v })),
  cancelOrder() {
    const reason = prompt('Reason to cancel this order?'); if (!reason) return;
    const approved_by = ['created', 'confirmed'].includes(S.order.status) ? undefined : prompt('Manager approval (name)') || undefined;
    act(() => req('POST', `/orders/${oid()}/cancel`, { reason, approved_by }));
  },
  async history() { S.history = S.history ? null : await safe(() => req('GET', `/orders/${oid()}/history`)) || null; render(); },

  // kitchen
  async kstatus(d) { await safe(() => req('PATCH', `/kot/${d.id}/status`, { status: d.v })); refresh(); },
  async kretry(d) { await safe(() => req('POST', `/kot/${d.id}/retry`)); refresh(); },

  // takeaway / delivery desk
  ftype: (d) => { S.form.type = d.v; render(); },
  async createOther() {
    const f = S.form;
    const body = f.type === 'takeaway' ? { order_type: 'takeaway', customer_name: f.name || undefined, customer_phone: f.phone || undefined }
      : { order_type: 'delivery', customer_name: f.name || undefined, customer_phone: f.phone || undefined, delivery_address: f.address || undefined, delivery_platform: f.platform || undefined, source: f.platform ? 'platform' : 'phone' };
    const o = await safe(() => req('POST', '/orders', { branch_id: BRANCH, ...body }, { 'Idempotency-Key': uuid() }));
    if (o) { S.form = { type: f.type, name: '', phone: '', address: '', platform: '' }; openOrder(o.id); }
  },
  async handover(d) { await safe(() => req('POST', `/orders/${d.id}/handover`)); refresh(); },
  async dly(d) {
    let body = {};
    if (d.v === 'assign') { const rider = prompt('Rider name?'); if (!rider) return; body = { rider }; }
    if (d.v === 'fail') { const reason = prompt('Failure reason?'); if (!reason) return; body = { reason }; }
    await safe(() => req('POST', `/deliveries/${d.id}/${d.v}`, body)); refresh();
  },
  async codpaid(d) { await safe(() => req('PATCH', `/orders/${d.id}/payment-status`, { payment_status: 'paid' })); refresh(); },
  async ostatus(d) { await safe(() => req('POST', `/orders/${d.id}/status`, { status: d.v })); refresh(); },
};

document.addEventListener('click', (e) => { const el = e.target.closest('[data-a]'); if (!el || el.disabled) return; const f = A[el.dataset.a]; if (f) f(el.dataset, el); });
document.addEventListener('change', (e) => {
  const c = e.target.dataset.c;
  if (c === 'priority') S.priority = e.target.value;
  if (c === 'role') { user = { id: e.target.value + '-1', role: e.target.value }; if (user.role === 'kitchen') { S.tab = 'kitchen'; refresh(); } }
});
document.addEventListener('input', (e) => { const t = e.target; if (t.dataset.f) S.form[t.dataset.f] = t.value; if (t.dataset.d === 'note' && S.dialog) S.dialog.note = t.value; });

// ---------- live updates: poll the event outbox, refresh only when something changed ----------
async function poll() {
  try { const { id } = await req('GET', '/events/latest'); if (id !== S.lastEvent) { S.lastEvent = id; if (!typing()) await refresh(); } } catch { /* server restarting */ }
}
render(); refresh();
setInterval(poll, 2000);
setInterval(() => { if (S.tab === 'kitchen' && !typing()) render(); }, 30000); // keep "x min" timers fresh
