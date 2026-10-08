/* ===========================================================================
   Report builder — form in, finished HTML report out.

   The renderer below is a direct port of generate_report.py, so the browser
   and the command-line tool produce byte-identical output from the same data.
   If you change one, change the other.
   =========================================================================== */

const CATEGORY_COLOURS = {
  'Data accuracy': '#0a85e0',
  'Data completeness': '#00a08a',
  'UI / formatting': '#6ec56a',
  'Content / wording': '#8b7cf6',
  Performance: '#f59e0b',
  Security: '#fb7185',
};
const FALLBACK_COLOURS = ['#38bdf8', '#34d399', '#a78bfa', '#fbbf24', '#fb7185', '#22d3ee'];
const STATUS_COLOURS = {
  closed: '#00a08a',
  open: '#fb7185',
  reopened: '#f59e0b',
  'in progress': '#fbbf24',
  deferred: '#94a3b8',
};
const STATUSES = ['closed', 'open', 'in progress', 'reopened', 'deferred'];

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------------------------------------------------------------- state -- */

let state = structuredClone(PAYLOAD.sample);

/* --------------------------------------------------------------- charts -- */

function donutSlices(pairs, cx = 60, cy = 60, r = 46, inner = 24) {
  const total = pairs.reduce((a, p) => a + p[1], 0);
  if (!total) return [];
  const out = [];
  let angle = -90;
  for (const [label, value, colour] of pairs) {
    const sweep = Math.min((value / total) * 360, 359.99);
    const a0 = (angle * Math.PI) / 180;
    const a1 = ((angle + sweep) * Math.PI) / 180;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi0 = cx + inner * Math.cos(a0), yi0 = cy + inner * Math.sin(a0);
    const xi1 = cx + inner * Math.cos(a1), yi1 = cy + inner * Math.sin(a1);
    const lg = sweep > 180 ? 1 : 0;
    out.push({
      label, value, colour,
      pct: Math.round((value / total) * 1000) / 10,
      d: `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${lg} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
         `L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${inner} ${inner} 0 ${lg} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z`,
    });
    angle += sweep;
  }
  return out;
}

function donutHtml(slices, centreValue, centreLabel) {
  const paths = slices.map((s) =>
    `          <path d="${s.d}" fill="${s.colour}" opacity=".92"><title>${esc(s.label)}: ${s.value} (${s.pct}%)</title></path>`
  ).join('\n');
  const legend = slices.map((s) =>
    `          <li><span class="sw" style="background:${s.colour}"></span>${esc(s.label)}<b>${s.value}</b><i>${s.pct}%</i></li>`
  ).join('\n');
  return `        <svg viewBox="0 0 120 120" width="150" height="150" role="img" aria-label="${esc(centreLabel)}: ${centreValue}">
${paths}
          <text x="60" y="58" text-anchor="middle" class="pie-n">${centreValue}</text>
          <text x="60" y="70" text-anchor="middle" class="pie-l">${esc(centreLabel)}</text>
        </svg>
        <ul class="legend">
${legend}
        </ul>`;
}

function gaugeHtml(passRate) {
  const c = 2 * Math.PI * 52;
  const filled = (c * passRate) / 100;
  return `      <figure class="gauge">
        <svg viewBox="0 0 120 120" width="170" height="170" role="img" aria-label="Pass rate ${passRate}%">
          <defs>
            <linearGradient id="pg" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stop-color="#6ec56a"/><stop offset="34%" stop-color="#00a08a"/>
              <stop offset="68%" stop-color="#0a85e0"/><stop offset="100%" stop-color="#4f6bf0"/>
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="13"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--fail)" stroke-width="13" transform="rotate(-90 60 60)"/>
          <circle cx="60" cy="60" r="52" fill="none" stroke="url(#pg)" stroke-width="13"
                  stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${c.toFixed(2)}"
                  transform="rotate(-90 60 60)"/>
        </svg>
        <figcaption><span class="pct">${passRate}%</span><span class="lbl">Pass rate</span></figcaption>
      </figure>`;
}

/* -------------------------------------------------------------- sections -- */

function coverageBars(types, total) {
  return types.map((rt) => {
    const passed = +rt.passed || 0, failed = +rt.failed || 0;
    const sp = total ? (passed / total) * 100 : 0;
    const sf = total ? (failed / total) * 100 : 0;
    let fig = `${passed} passed`;
    if (failed) fig += ` · <span style="color:var(--fail)">${failed} failed</span>`;
    if (rt.note) fig += ` · ${esc(rt.note)}`;
    const failSpan = failed ? `<span class="seg-fail" style="width:${sf.toFixed(1)}%"></span>` : '';
    return `        <div>
          <div class="bar-top"><span class="bar-name">${esc(rt.name)}</span>
            <span class="bar-fig">${fig}</span></div>
          <div class="track"><span class="seg-pass" style="width:${sp.toFixed(1)}%"></span>${failSpan}</div>
        </div>`;
  }).join('\n');
}

function defectTables(defects) {
  const row = (d) => {
    let tag = '';
    if (d.status === 'reopened') tag = '<span class="tag t-fail">Reopened</span>';
    else if (d.severity === 'urgent') tag = '<span class="tag t-fail">Urgent</span>';
    else if (d.status !== 'closed')
      tag = `<span class="tag t-warn">${esc(d.status.replace(/^./, (c) => c.toUpperCase()))}</span>`;
    return `          <tr><td class="num">${esc(d.id)}</td><td>${esc(d.area || '')}</td><td>${d.finding || ''}</td><td>${tag}</td></tr>`;
  };
  const table = (title, rows) => !rows.length ? '' :
`    <div class="card">
      <h3 style="margin-top:0">${title}</h3>
      <table>
        <thead><tr><th>ID</th><th>Area</th><th>Finding</th><th>Status</th></tr></thead>
        <tbody>
${rows.map(row).join('\n')}
        </tbody>
      </table>
    </div>`;
  const closed = defects.filter((d) => d.status === 'closed');
  const open = defects.filter((d) => d.status !== 'closed');
  return table(`Closed after validation (${closed.length})`, closed) + '\n' +
         table(`Outstanding (${open.length})`, open);
}

function renderBlocks(blocks) {
  return (blocks || []).map((b) => {
    if (b.type === 'para') return `      <p style="margin-top:0;font-size:13.5px;color:var(--ink-2)">${b.text}</p>`;
    if (b.type === 'heading') return `      <h3>${esc(b.text)}</h3>`;
    if (b.type === 'list') return `      <ul class="read">\n${b.items.map((i) => `        <li>${i}</li>`).join('\n')}\n      </ul>`;
    if (b.type === 'callout') return `      <div class="${b.variant === 'risk' ? 'callout risk' : 'callout'}">${b.text}</div>`;
    if (b.type === 'table') {
      const head = b.headers.map((h) => `<th>${esc(h)}</th>`).join('');
      const body = b.rows.map((r) => '          <tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('\n');
      return `      <table>\n        <thead><tr>${head}</tr></thead>\n        <tbody>\n${body}\n        </tbody>\n      </table>`;
    }
    return '';
  }).join('\n');
}

function renderSections(sections, start) {
  return (sections || []).map((s, i) => `  <section>
    <h2>${start + i}. ${esc(s.title)}</h2>
${s.lead ? `    <p class="lead">${s.lead}</p>` : ''}
    <div class="card">
${renderBlocks(s.blocks)}
    </div>
  </section>`).join('\n\n');
}

/* ---------------------------------------------------------------- build -- */

function buildReport(data) {
  const meta = data.meta || {};
  const types = data.report_types || [];
  const defects = data.defects || [];

  const total = types.reduce((a, t) => a + (+t.passed || 0) + (+t.failed || 0), 0);
  const passed = types.reduce((a, t) => a + (+t.passed || 0), 0);
  const failed = total - passed;
  const passRate = total ? Math.round((passed / total) * 1000) / 10 : 0;

  const urgent = defects.filter((d) => d.severity === 'urgent').length;
  const openCount = defects.filter((d) => d.status !== 'closed').length;

  const catCount = {};
  defects.forEach((d) => { catCount[d.category] = (catCount[d.category] || 0) + 1; });
  let fb = 0;
  const catPairs = Object.entries(catCount).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [k, v, CATEGORY_COLOURS[k] || FALLBACK_COLOURS[fb++ % FALLBACK_COLOURS.length]]);

  const stCount = {};
  defects.forEach((d) => { stCount[d.status] = (stCount[d.status] || 0) + 1; });
  const order = STATUSES.filter((s) => stCount[s])
    .concat(Object.keys(stCount).filter((s) => !STATUSES.includes(s)));
  const stPairs = order.map((s) => [s, stCount[s], STATUS_COLOURS[s] || '#94a3b8']);

  const defectSection = !defects.length ? '' : `  <section>
    <h2>2. Defect profile</h2>
    <p class="lead">${defects.length} defects handled in the period.</p>
    <div class="charts">
      <div class="card">
        <h3 style="margin-top:0">By category</h3>
        <div class="chart">
${donutHtml(donutSlices(catPairs), defects.length, 'defects')}
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">By status</h3>
        <div class="chart">
${donutHtml(donutSlices(stPairs), defects.length, 'defects')}
        </div>
      </div>
    </div>
${data.defect_callout ? `    <div class="callout">${data.defect_callout}</div>` : ''}
  </section>`;

  const repl = {
    __LOGO__: 'data:image/png;base64,' + PAYLOAD.logo,
    __TITLE__: esc(meta.title),
    __DOC_TYPE__: esc(meta.doc_type || 'Test Report'),
    __PERIOD__: esc(meta.period || ''),
    __ENV__: esc(meta.environment || ''),
    __PREPARED_BY__: esc(meta.prepared_by || ''),
    __STATUS__: esc(meta.status || ''),
    __FOOTER__: esc(meta.footer_note || ''),
    __GAUGE__: gaugeHtml(passRate),
    __TOTAL__: String(total),
    __PASSED__: String(passed),
    __URGENT__: String(urgent || failed),
    __URGENT_LABEL__: urgent === 1 ? 'Urgent defect' : urgent ? 'Urgent defects' : 'Failed',
    __OPEN__: String(openCount),
    __SUMMARY_CALLOUT__: data.summary_callout ? `<div class="callout">${data.summary_callout}</div>` : '',
    __DEFECT_SECTION__: defectSection,
    __COVERAGE_BARS__: coverageBars(types, total),
    __DEFECT_TABLES__: defectTables(defects),
    __SECTIONS__: renderSections(data.sections, 5),
  };

  let out = PAYLOAD.template;
  for (const [k, v] of Object.entries(repl)) out = out.split(k).join(v);
  return { html: out, total, passed, passRate, defects: defects.length, openCount };
}

/* ------------------------------------------------------------------ UI --- */

const $ = (s) => document.querySelector(s);

function metaFields() {
  const m = state.meta;
  const f = [
    ['title', 'Report title'], ['period', 'Period'], ['environment', 'Environment'],
    ['prepared_by', 'Prepared by'], ['status', 'Status'], ['doc_type', 'Header label'],
  ];
  $('#meta').innerHTML = f.map(([k, label]) =>
    `<label><span>${label}</span><input data-meta="${k}" value="${esc(m[k] || '')}" /></label>`
  ).join('');
  $('#meta').oninput = (e) => {
    const k = e.target.dataset.meta;
    if (k) { state.meta[k] = e.target.value; refresh(); }
  };
}

function typeRows() {
  $('#types').innerHTML = (state.report_types || []).map((t, i) => `
    <tr>
      <td><input data-t="${i}" data-f="name" value="${esc(t.name)}" /></td>
      <td><input data-t="${i}" data-f="passed" type="number" min="0" value="${t.passed ?? 0}" class="n" /></td>
      <td><input data-t="${i}" data-f="failed" type="number" min="0" value="${t.failed ?? 0}" class="n" /></td>
      <td><input data-t="${i}" data-f="note" value="${esc(t.note || '')}" /></td>
      <td><button class="del" data-del-t="${i}" title="Remove">×</button></td>
    </tr>`).join('');
}

function defectRows() {
  $('#defects').innerHTML = (state.defects || []).map((d, i) => `
    <tr>
      <td><input data-d="${i}" data-f="id" value="${esc(d.id)}" class="s" /></td>
      <td><input data-d="${i}" data-f="category" value="${esc(d.category)}" list="cats" /></td>
      <td>
        <select data-d="${i}" data-f="status">
          ${STATUSES.map((s) => `<option${s === d.status ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><input data-d="${i}" data-f="area" value="${esc(d.area || '')}" /></td>
      <td><input data-d="${i}" data-f="finding" value="${esc(d.finding || '')}" class="w" /></td>
      <td style="text-align:center">
        <input type="checkbox" data-d="${i}" data-f="severity" ${d.severity === 'urgent' ? 'checked' : ''} />
      </td>
      <td><button class="del" data-del-d="${i}" title="Remove">×</button></td>
    </tr>`).join('');
}

function refresh() {
  const r = buildReport(state);
  $('#stat-total').textContent = r.total;
  $('#stat-passed').textContent = r.passed;
  $('#stat-rate').textContent = r.passRate + '%';
  $('#stat-defects').textContent = r.defects;
  $('#stat-open').textContent = r.openCount;
  $('#preview').srcdoc = r.html;
}

function wire() {
  $('#types').oninput = (e) => {
    const i = e.target.dataset.t, f = e.target.dataset.f;
    if (i === undefined) return;
    state.report_types[i][f] = e.target.type === 'number' ? +e.target.value : e.target.value;
    refresh();
  };
  $('#defects').oninput = (e) => {
    const i = e.target.dataset.d, f = e.target.dataset.f;
    if (i === undefined) return;
    if (f === 'severity') {
      if (e.target.checked) state.defects[i].severity = 'urgent';
      else delete state.defects[i].severity;
    } else {
      state.defects[i][f] = e.target.value;
    }
    refresh();
  };
  document.body.addEventListener('click', (e) => {
    const dt = e.target.dataset.delT, dd = e.target.dataset.delD;
    if (dt !== undefined) { state.report_types.splice(dt, 1); typeRows(); refresh(); }
    if (dd !== undefined) { state.defects.splice(dd, 1); defectRows(); refresh(); }
  });

  $('#add-type').onclick = () => {
    state.report_types.push({ name: 'New area', passed: 0, failed: 0, note: '' });
    typeRows(); refresh();
  };
  $('#add-defect').onclick = () => {
    state.defects.push({ id: '', category: 'Data accuracy', status: 'open', area: '', finding: '' });
    defectRows(); refresh();
  };

  $('#callout-summary').value = state.summary_callout || '';
  $('#callout-defect').value = state.defect_callout || '';
  $('#callout-summary').oninput = (e) => { state.summary_callout = e.target.value; refresh(); };
  $('#callout-defect').oninput = (e) => { state.defect_callout = e.target.value; refresh(); };

  $('#download').onclick = () => {
    const r = buildReport(state);
    const name = (state.meta.title || 'test-report')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const blob = new Blob([r.html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.html';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Data in and out, so a report can be reopened and amended later, and so the
  // same file works with the command-line generator.
  $('#export-json').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'report_data.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#import-json').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        state = JSON.parse(fr.result);
        metaFields(); typeRows(); defectRows();
        $('#callout-summary').value = state.summary_callout || '';
        $('#callout-defect').value = state.defect_callout || '';
        refresh();
      } catch (err) {
        alert('Could not read that file as JSON:\n' + err.message);
      }
    };
    fr.readAsText(file);
    e.target.value = '';
  };
  $('#reset').onclick = () => {
    if (!confirm('Discard all changes and reload the sample data?')) return;
    state = structuredClone(PAYLOAD.sample);
    metaFields(); typeRows(); defectRows();
    $('#callout-summary').value = state.summary_callout || '';
    $('#callout-defect').value = state.defect_callout || '';
    refresh();
  };
}

metaFields();
typeRows();
defectRows();
wire();
refresh();
