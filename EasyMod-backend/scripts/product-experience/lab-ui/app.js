'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const state = { dataset: null, health: null, history: [], run: null, poll: null, pollingId: null, scenarios: [] };
  const terminalStatuses = new Set(['completed', 'complete', 'succeeded', 'success', 'failed', 'error', 'cancelled', 'canceled', 'done']);
  const text = value => value == null ? 'Unavailable' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const first = (...values) => values.find(value => value !== undefined && value !== null);
  const el = (tag, content, className) => {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = text(content);
    if (className) node.className = className;
    return node;
  };
  const clear = node => node.replaceChildren();
  function notify(message, error = false) {
    const notice = $('notice');
    notice.textContent = message;
    notice.className = error ? 'error' : '';
    notice.hidden = false;
  }
  async function request(path, body) {
    if (!path.startsWith('/__lab/api/')) throw new Error('Only local lab endpoints are allowed.');
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (body !== undefined) {
      const token = document.querySelector('meta[name="lab-token"]')?.content;
      if (!token) throw new Error('The lab request token is missing. Reload this page from the local lab server.');
      headers['X-Lab-Token'] = token;
    }
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data;
    try { data = await response.json(); } catch (_) { throw new Error(`The lab returned an unreadable response (${response.status}).`); }
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : first(data.message, data.error?.message, `Request failed (${response.status}).`));
    return data;
  }
  function empty(node, title, description) {
    clear(node);
    const box = el('div', undefined, 'empty');
    box.append(el('strong', title), el('span', description));
    node.append(box);
  }
  function badge(value) {
    const label = text(value);
    const normalized = label.toLowerCase();
    const style = /failed|error|violation/.test(normalized) ? 'bad' : /blocked|held|fallback|unknown|uncertain|suppres/.test(normalized) ? 'warning' : 'neutral';
    return el('span', label.replace(/_/g, ' '), `badge ${style}`);
  }
  function keys(node, entries) {
    clear(node);
    entries.forEach(([key, value]) => {
      const row = el('div'); row.append(el('dt', key), el('dd', value)); node.append(row);
    });
  }
  function details(value, title = 'Inspect safe JSON') {
    const box = el('details', undefined, 'json-details');
    box.append(el('summary', title), el('pre', JSON.stringify(value, null, 2)));
    return box;
  }
  function action(label, callback, primary = false) {
    const button = el('button', label, `button ${primary ? 'primary' : 'secondary'} small`);
    button.type = 'button';
    button.addEventListener('click', () => Promise.resolve().then(callback).catch(error => notify(error.message, true)));
    return button;
  }
  function metric(label, value, note) {
    const card = el('article', undefined, 'stat-card');
    card.append(el('div', label, 'stat-label'), el('strong', value, 'stat-value'));
    if (note) card.append(el('p', note, 'stat-note'));
    return card;
  }
  function tags(values) {
    const box = el('div', undefined, 'tag-list');
    (Array.isArray(values) ? values : values ? [values] : []).forEach(value => box.append(el('span', value, 'tag')));
    if (!box.childNodes.length) box.append(el('span', 'Not classified', 'muted'));
    return box;
  }
  function table(node, columns, rows, caption) {
    clear(node);
    if (!rows.length) return empty(node, 'No records available', 'Results will appear when the local API returns records.');
    const wrap = el('div', undefined, 'table-wrap');
    const grid = el('table');
    if (caption) grid.append(el('caption', caption));
    const head = el('thead'); const headRow = el('tr');
    columns.forEach(column => { const th = el('th', column.label); th.scope = 'col'; headRow.append(th); });
    head.append(headRow); grid.append(head);
    const body = el('tbody');
    rows.forEach(row => {
      const tr = el('tr');
      columns.forEach(column => {
        const td = el('td'); const value = column.render(row);
        td.append(value instanceof Node ? value : el('span', value)); tr.append(td);
      });
      body.append(tr);
    });
    grid.append(body); wrap.append(grid); node.append(wrap);
  }
  function activateTab(name, focus = false) {
    document.querySelectorAll('[role="tab"]').forEach(tab => {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) tab.focus();
    });
    if (name === 'history') refreshHistory().catch(error => notify(error.message, true));
  }
  $('tabs').addEventListener('click', event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) activateTab(tab.dataset.tab);
  });
  $('tabs').addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); activateTab(tabs[next].dataset.tab, true); }
  });
  const mediaQuery = window.matchMedia('(max-width: 860px)');
  const updateTabOrientation = () => $('tabs').setAttribute('aria-orientation', mediaQuery.matches ? 'horizontal' : 'vertical');
  mediaQuery.addEventListener('change', updateTabOrientation); updateTabOrientation();

  function distribution(node, values) {
    clear(node);
    const entries = Object.entries(values || {});
    const total = entries.reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
    if (!entries.length) return void node.append(el('p', 'Coverage counts unavailable.', 'muted'));
    entries.forEach(([label, count]) => {
      const row = el('div', undefined, 'distribution-row');
      const track = el('div', undefined, 'bar-track'); track.setAttribute('aria-hidden', 'true');
      const fill = el('progress', undefined, 'bar-fill');
      const maximum = Math.max(1, total);
      fill.setAttribute('max', String(maximum));
      fill.setAttribute('value', String(Math.max(0, Math.min(maximum, Number(count) || 0))));
      track.append(fill); row.append(el('span', label), track, el('span', count)); node.append(row);
    });
  }
  async function loadDataset() {
    const data = await request('/__lab/api/dataset'); state.dataset = data;
    const source = data.source || {};
    clear($('dataset-stats'));
    $('dataset-stats').append(metric('Personas', source.personaCount, 'Source dataset'), metric('Scenario turns', source.scenarioCount, 'Ordered source records'), metric('Input formats', Object.keys(data.counts?.inputTypes || {}).length, 'As reported by the API'), metric('Languages', Object.keys(data.counts?.languages || {}).length, 'As reported by the API'));
    keys($('source-details'), [['Source SHA-256', source.sha256], ['Personas', source.personaCount], ['Scenario turns', source.scenarioCount], ['Provenance', 'Source metadata · not catalog truth']]);
    distribution($('input-counts'), data.counts?.inputTypes); distribution($('language-counts'), data.counts?.languages);
    document.querySelectorAll('[data-persona-select]').forEach(select => {
      const previous = select.value; clear(select);
      if (!data.personas?.length) { const option = el('option', 'No personas available'); option.value = ''; select.append(option); }
      (data.personas || []).forEach(persona => { const option = el('option', `${persona.id} · ${persona.turnCount} turns`); option.value = persona.id; select.append(option); });
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
    });
  }
  function renderScenarios() {
    const query = $('scenario-search').value.trim().toLowerCase();
    const classification = $('scenario-filter').value;
    const filtered = state.scenarios.filter(row => {
      const matchesQuery = !query || row.scenarioId.toLowerCase().includes(query);
      const matchesClassification = !classification || row.classificationTags.includes(classification);
      return matchesQuery && matchesClassification;
    });
    $('scenario-count').textContent = `${filtered.length} of ${state.scenarios.length} loaded turns`;
    table($('scenario-results'), [
      { label: 'Scenario', render: row => row.scenarioId }, { label: 'Turn', render: row => row.turn },
      { label: 'Input / language', render: row => `${text(row.inputType)} / ${text(row.language)}` },
      { label: 'Classification', render: row => tags(row.classificationTags) },
      { label: 'Source input', render: row => `${row.sourceInputPresent ? 'text present' : 'image only'} · ${row.attachmentCount} media labels` },
      { label: 'Review', render: row => action('Inspect evidence', () => inspectEvidence(row.scenarioId)) },
    ], filtered, `Persona ${$('scenario-persona').value} · Source metadata; attachment labels are not visual evidence`);
  }
  async function loadScenarios() {
    const personaId = $('scenario-persona').value;
    if (!personaId) throw new Error('Choose a persona first.');
    empty($('scenario-results'), 'Loading scenarios…', 'Reading sanitized source metadata.');
    const data = await request(`/__lab/api/scenarios?personaId=${encodeURIComponent(personaId)}`);
    state.scenarios = data.scenarios || [];
    const filter = $('scenario-filter'); const selected = filter.value; clear(filter);
    const all = el('option', 'All classifications'); all.value = ''; filter.append(all);
    [...new Set(state.scenarios.flatMap(row => row.classificationTags || []))].sort().forEach(value => { const option = el('option', value); option.value = value; filter.append(option); });
    if ([...filter.options].some(option => option.value === selected)) filter.value = selected;
    renderScenarios();
  }
  const runId = run => first(run?.runId, run?.id);
  const turnsOf = run => { const turns = first(run?.turns, run?.results, run?.trace, run?.report?.turns, []); return Array.isArray(turns) ? turns : []; };
  const decisionOf = turn => first(turn.disposition, turn.outboundDecision, turn.verdict?.decision, turn.gate?.decision, turn.decision);
  const reasonOf = turn => first(turn.outboundReason, turn.reasonCode, turn.verdict?.reasonCode, turn.gate?.reasonCode);
  const runRevision = run => first(run?.revision, run?.sourceRevision, run?.git?.revision);
  const runHash = run => first(run?.source?.sha256, run?.dataset?.sha256);
  function runFacts(run) {
    return [['Run ID', runId(run)], ['Status', run?.status], ['Revision', runRevision(run)], ['Source hash', runHash(run)], ['Mode', first(run?.executionMode, run?.mode, run?.provenance?.mode)], ['Started', run?.startedAt], ['Progress', run?.progress ? `${text(run.progress.completed)} / ${text(run.progress.total)}` : 'Unavailable'], ['Recorded turns', turnsOf(run).length]];
  }
  function exportLinks(run) {
    const row = el('div', undefined, 'button-row');
    if (!runId(run)) return row;
    ['json', 'csv'].forEach(format => {
      const link = el('a', `Export ${format.toUpperCase()}`, 'button secondary small');
      link.href = `/__lab/api/export/${encodeURIComponent(runId(run))}.${format}`; link.download = ''; row.append(link);
    });
    return row;
  }
  function renderRun(run) {
    state.run = run;
    $('active-run-summary').textContent = `${text(runId(run))} · ${text(run.status)} · ${run.progress ? `${text(run.progress.completed)} / ${text(run.progress.total)} turns` : `${turnsOf(run).length} recorded turns`}`;
    clear($('replay-run-bar'));
    const heading = el('div', undefined, 'card-heading'); heading.append(el('h2', `Run ${text(runId(run))}`), badge(run.status));
    const info = el('dl', undefined, 'key-values'); keys(info, runFacts(run));
    $('replay-run-bar').append(heading, info, exportLinks(run));
    const scope = first(run.provenance, run.adapterMode, run.executionMode, run.mode);
    if (scope !== undefined) $('replay-run-bar').append(details(scope, 'Execution provenance'));
    const turns = turnsOf(run); const target = $('replay-results'); clear(target);
    if (!turns.length) empty(target, 'No safe turn results yet', 'Run status and progress will update while the local harness is running.');
    turns.forEach((turn, index) => {
      const card = el('article', undefined, 'card turn-card');
      const top = el('div', undefined, 'turn-heading');
      top.append(el('span', first(turn.turn, index + 1), 'turn-number'), el('h2', first(turn.scenarioId, turn.id, `Turn ${index + 1}`)), badge(first(decisionOf(turn), turn.status, 'Recorded')));
      card.append(top);
      if (turn.responseTextStored === false) card.append(el('div', 'Unredacted free text is omitted; redacted input, candidate, and validated reply remain inspectable.', 'turn-output'));
      const facts = el('dl', undefined, 'key-values'); keys(facts, [['Router source', first(turn.routerSource, turn.source)], ['Reason', reasonOf(turn)], ['Product evidence', first(turn.productEvidence?.status, turn.grounding?.productStatus)], ['Provider mode', turn.provider?.mode], ['Model calls', turn.provider?.calls], ['Trace ID', turn.traceId]]);
      card.append(facts, details(turn));
      const traceRows = [
        ['Customer input (redacted)', turn.inputRedacted],
        ['Gemini candidate (redacted)', turn.modelCandidateRedacted],
        ['Validated reply (redacted)', turn.finalReplyRedacted],
      ].filter(([, value]) => typeof value === 'string');
      if (traceRows.length) {
        const tracePanel = el('details', undefined, 'json-details');
        tracePanel.append(el('summary', 'Inspect redacted conversation trace'));
        const traceBody = el('dl', undefined, 'key-values'); keys(traceBody, traceRows);
        tracePanel.append(traceBody); card.append(tracePanel);
      }
      if (turn.scenarioId) card.append(action('Inspect evidence', () => inspectEvidence(turn.scenarioId)));
      target.append(card);
    });
    renderCost(run); renderTriage(run);
  }
  function stopPolling() { if (state.poll) window.clearTimeout(state.poll); state.poll = null; state.pollingId = null; }
  function isTerminal(run) { return terminalStatuses.has(String(run.status || '').toLowerCase()); }
  async function openRun(id, showReplay = true) {
    stopPolling();
    const run = await request(`/__lab/api/runs/${encodeURIComponent(id)}`);
    renderRun(run);
    if (showReplay) activateTab('replay');
    if (!isTerminal(run)) { state.pollingId = id; schedulePoll(id, run); }
  }
  function schedulePoll(id, run) {
    // Poll only a pending run; the server may provide a bounded polling hint.
    const delay = Math.max(500, Math.min(10000, Number(run.pollAfterMs) || 1000));
    state.poll = window.setTimeout(async () => {
      if (state.pollingId !== id) return;
      try {
        const next = await request(`/__lab/api/runs/${encodeURIComponent(id)}`);
        if (state.pollingId !== id) return;
        renderRun(next);
        if (isTerminal(next)) { stopPolling(); await refreshHistory(); notify(`Run ${id}: ${text(next.status)}.`); }
        else schedulePoll(id, next);
      } catch (error) { stopPolling(); notify(`Run polling stopped: ${error.message} Reopen the run from history to retry.`, true); }
    }, delay);
  }
  async function startRun(scope) {
    const personaId = $('run-persona').value;
    if (scope === 'persona' && !personaId) throw new Error('Choose a persona first.');
    document.querySelectorAll('[data-run-action]').forEach(button => { button.disabled = true; });
    empty($('active-run-summary'), 'Starting local replay…', 'Waiting for the local runner to accept this bounded request.');
    try {
      const result = await request('/__lab/api/runs', { scope, mode: $('run-mode').value, ...(scope === 'persona' ? { personaId } : {}) });
      if (!result.runId) throw new Error('The API did not return a run ID.');
      notify(`Created run ${result.runId}.`); await openRun(result.runId); await refreshHistory();
    } finally { document.querySelectorAll('[data-run-action]').forEach(button => { button.disabled = false; }); }
  }
  async function refreshHistory() {
    const data = await request('/__lab/api/history');
    state.history = Array.isArray(data) ? data : first(data.runs, data.history, []);
    if (!Array.isArray(state.history)) state.history = [];
    table($('history-results'), [
      { label: 'Run', render: row => runId(row) }, { label: 'Status', render: row => badge(row.status) },
      { label: 'Scope / mode', render: row => `${text(first(row.scope, row.personaId))} / ${text(first(row.executionMode, row.mode))}` }, { label: 'Created', render: row => first(row.createdAt, row.startedAt) },
      { label: 'Revision', render: row => el('code', runRevision(row)) },
      { label: 'Review', render: row => action('Open run', () => openRun(runId(row))) },
    ], state.history, 'Recorded local runs · Open a run to inspect its provenance and exports');
    ['baseline-run', 'candidate-run'].forEach(id => {
      const select = $(id); const selected = select.value; clear(select);
      const placeholder = el('option', 'Choose a recorded run'); placeholder.value = ''; select.append(placeholder);
      state.history.forEach(run => { const option = el('option', `${text(runId(run))} · ${text(run.status)}`); option.value = runId(run); select.append(option); });
      if (state.history.some(run => String(runId(run)) === selected)) select.value = selected;
    });
  }
  async function compareRuns() {
    const baselineId = $('baseline-run').value; const candidateId = $('candidate-run').value;
    if (!baselineId || !candidateId) throw new Error('Select both recorded runs.');
    if (baselineId === candidateId) throw new Error('Select two different runs to compare.');
    const [baseline, candidate] = await Promise.all([request(`/__lab/api/runs/${encodeURIComponent(baselineId)}`), request(`/__lab/api/runs/${encodeURIComponent(candidateId)}`)]);
    const target = $('comparison-results'); clear(target);
    const comparable = Boolean(runHash(baseline) && runHash(baseline) === runHash(candidate) && isTerminal(baseline) && isTerminal(candidate));
    target.append(el('p', comparable ? 'Both runs are terminal and report the same dataset source hash. Review engine revisions and fixture versions before attributing differences to code.' : 'Comparability is not established: dataset hashes differ or are unavailable, or a run is still active. Differences below are descriptive.', 'section-note'));
    const grid = el('div', undefined, 'comparison-grid');
    [[baseline, 'Baseline selection'], [candidate, 'Candidate selection']].forEach(([run, label]) => { const card = el('article', undefined, 'card'); const dl = el('dl', undefined, 'key-values'); keys(dl, runFacts(run)); card.append(el('h2', label), dl, details(first(run.summary, run.metrics, run.performance, run), 'Recorded summary'), exportLinks(run)); grid.append(card); });
    target.append(grid);
    const baselineTurns = new Map(turnsOf(baseline).map(turn => [first(turn.scenarioId, turn.id), turn]));
    const candidateTurns = new Map(turnsOf(candidate).map(turn => [first(turn.scenarioId, turn.id), turn]));
    const ids = [...new Set([...baselineTurns.keys(), ...candidateTurns.keys()])].filter(Boolean);
    const card = el('article', undefined, 'card'); const rows = ids.map(id => ({ id, before: baselineTurns.get(id), after: candidateTurns.get(id) }));
    table(card, [{ label: 'Scenario', render: row => row.id }, { label: 'Baseline decision', render: row => badge(row.before ? decisionOf(row.before) : 'Not recorded') }, { label: 'Candidate decision', render: row => badge(row.after ? decisionOf(row.after) : 'Not recorded') }, { label: 'Reason change', render: row => `${text(row.before && reasonOf(row.before))} → ${text(row.after && reasonOf(row.after))}` }, { label: 'Response digest', render: row => !row.before || !row.after ? 'Unmatched receipt' : row.before.productResponseDigest && row.after.productResponseDigest ? row.before.productResponseDigest === row.after.productResponseDigest ? 'Same digest' : 'Different digest' : 'Digest unavailable' }, { label: 'Safe receipts', render: row => details({ baseline: row.before || null, candidate: row.after || null }, 'Inspect matched receipts') }], rows, 'Aligned by scenario ID · A decision change alone does not establish an improvement'); target.append(card);
  }
  async function inspectEvidence(id) {
    if (!id) throw new Error('Enter a scenario ID.');
    $('evidence-id').value = id; activateTab('evidence');
    empty($('evidence-results'), 'Loading evidence…', 'Reading the local server’s safe evidence view.');
    const evidence = await request(`/__lab/api/evidence/${encodeURIComponent(id)}`);
    const target = $('evidence-results'); clear(target);
    target.append(el('h2', `Scenario ${id}`), el('p', 'Server-reported evidence · inspect provenance, tenant identity, freshness and fact states before drawing conclusions.', 'section-note'));
    const dl = el('dl', undefined, 'key-values'); keys(dl, [['Scenario', id], ['Tenant', first(evidence.tenantId, evidence.evidence?.[0]?.tenantId)], ['Oracle domain', evidence.oracle?.domain], ['Oracle eligibility', evidence.oracle?.eligibility], ['Expected disposition', evidence.oracle?.expectedDisposition], ['Grounding decision', evidence.groundingDecision], ['Required evidence', evidence.oracle?.requiredEvidence]]);
    const json = el('pre', JSON.stringify(evidence, null, 2)); target.append(dl, tags(evidence.classificationTags), json);
  }
  function renderCost(run) {
    const target = $('cost-results'); clear(target);
    const performance = first(run.performance, run.metrics?.performance, {});
    const usage = first(run.usage, run.metrics?.usage, {});
    const budget = first(run.evaluationBudget, run.metrics?.evaluationBudget, {});
    const budgetCalls = Array.isArray(budget.calls) ? budget.calls : [];
    const turns = turnsOf(run);
    const latencies = turns.map(turn => turn.latencyMs).filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
    const percentile = fraction => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * fraction) - 1)] : undefined;
    const completeCosts = turns.length > 0 && turns.every(turn => typeof turn.provider?.costUsd === 'number' && Number.isFinite(turn.provider.costUsd));
    const providerCost = completeCosts ? turns.reduce((sum, turn) => sum + turn.provider.costUsd, 0) : undefined;
    const providerCalls = first(budget.requestCount, turns.reduce((sum, turn) => sum + (Number(turn.provider?.calls) || 0), 0));
    const visionCalls = first(budget.visionRequestCount, budgetCalls.filter(call => call.vision).length);
    const calculatedTokens = budgetCalls.reduce((sum, call) => sum + (Number(call.inputTokens) || 0) + (Number(call.outputTokens) || 0), 0);
    const stats = el('div', undefined, 'stat-grid');
    stats.append(metric('p50 route latency', first(performance.p50Ms, performance.routeP50Ms, performance.routeLatencyMs?.p50, percentile(.5)), 'Milliseconds · recorded local turns'), metric('p95 route latency', first(performance.p95Ms, performance.routeP95Ms, performance.routeLatencyMs?.p95, percentile(.95)), 'Milliseconds · recorded local turns'), metric('Model tokens', first(usage.totalTokens, performance.modelTokenCount, calculatedTokens || undefined), 'Unavailable when not measured'), metric('Provider reported spend (USD)', first(performance.providerReportedSpendUsd, budget.providerReportedUsd, performance.estimatedSpendUsd, usage.estimatedCostUsd, performance.estimatedProviderCostUsd, providerCost), 'Recorded provider usage; not a production forecast'), metric('Provider calls', providerCalls, `${text(visionCalls)} vision calls · recorded evaluation budget`));
    const card = el('article', undefined, 'card'); card.append(el('h2', `Measurement record · ${text(runId(run))}`), tags([...new Set(turns.map(turn => turn.provider?.mode).filter(Boolean))]), details({ executionMode: run.executionMode, performance, usage, evaluationBudget: budget, providerCalls, visionCalls, measuredTurnCount: latencies.length, providers: turns.map(turn => ({ scenarioId: turn.scenarioId, provider: turn.provider, latencyMs: turn.latencyMs })), provenance: run.provenance }, 'Inspect recorded measurement scope')); target.append(stats, card);
  }
  function renderTriage(run) {
    const target = $('triage-results'); clear(target);
    const turns = turnsOf(run);
    const flagged = turns.filter(turn => turn.error || turn.passed === false || turn.success === false || (decisionOf(turn) && !['SEND', 'ANSWER', 'ANSWERED', 'RESPOND', 'RESPONDED'].includes(String(decisionOf(turn)).toUpperCase())) || turn.violations?.length);
    const card = el('article', undefined, 'card');
    card.append(el('p', 'This view includes explicit failures, violations and non-SEND outcomes. Safe fallback, hold or suppression is not automatically a defect.', 'section-note'));
    const holder = el('div'); table(holder, [{ label: 'Scenario', render: row => first(row.scenarioId, row.id, row.turn) }, { label: 'Outcome', render: row => badge(first(decisionOf(row), row.status, 'Error')) }, { label: 'Reason / violation', render: row => tags(first(row.violations, row.reasonCodes, reasonOf(row), row.error)) }, { label: 'Review', render: row => row.scenarioId ? action('Inspect evidence', () => inspectEvidence(row.scenarioId)) : 'No scenario ID' }], flagged, `${flagged.length} flagged records of ${turns.length} recorded turns`);
    if (!flagged.length) empty(holder, turns.length ? 'No flagged records in this view' : 'No results to triage yet', 'This is a filter result, not an accuracy or passing score.');
    card.append(holder); target.append(card);
    const fixtures = Array.isArray(run.triageFixtures) ? run.triageFixtures : [];
    if (fixtures.length) {
      const fixtureCard = el('article', undefined, 'card');
      fixtureCard.append(el('h2', 'Known safety canaries'), el('p', 'The fixture proposes an unsupported price, discount and delivery promise. A blocked proposal is a successful safety control; a sent proposal is a P1 failure.', 'section-note'));
      const fixtureHolder = el('div');
      table(fixtureHolder, [
        { label: 'Fixture', render: row => row.fixtureId }, { label: 'Severity', render: row => badge(row.severity) },
        { label: 'Result', render: row => badge(row.status) }, { label: 'Reason', render: row => row.reasonCode || 'Unavailable' },
        { label: 'Evidence', render: row => details({ evidenceProductIds: row.evidenceProductIds, evidenceFields: row.evidenceFields }, 'Inspect reproduction evidence') },
        { label: 'Rerun', render: row => action('Rerun fixture', async () => {
          const replay = await request('/__lab/api/triage/unsafe-price-claim/rerun', {});
          fixtureHolder.append(details(replay, `Rerun receipt ${text(replay.runId)}`));
          notify(`Triage fixture rerun: ${text(replay.candidate?.status)}.`);
        }) },
      ], fixtures, 'Fixed local adversarial candidate · no provider or external calls');
      fixtureCard.append(fixtureHolder); target.append(fixtureCard);
    }
  }
  async function playground() {
    const button = $('send-playground'); button.disabled = true;
    try {
      const body = { tenantId: $('tenant-id').value.trim(), sessionId: $('session-id').value.trim(), message: $('playground-message').value };
      const imageFixtureId = $('image-fixture').value.trim(); if (imageFixtureId) body.imageFixtureId = imageFixtureId;
      const result = await request('/__lab/api/playground', body);
      const target = $('playground-results'); clear(target);
      target.append(badge(first(decisionOf(result), result.status, 'Recorded result')));
      const output = first(result.answer, result.safeResponse, result.safeReply, result.responseText, result.replyText, typeof result.response === 'string' ? result.response : undefined);
      if (output !== undefined) target.append(el('div', output, 'turn-output'));
      const dl = el('dl', undefined, 'key-values'); keys(dl, [['Tenant', first(result.tenantId, body.tenantId)], ['Session', first(result.sessionId, body.sessionId)], ['Reason', reasonOf(result)], ['Provider mode', first(result.providerMode, result.mode, result.executionMode, result.provider?.mode)], ['Model calls', first(result.modelCalls, result.provider?.calls)], ['Provider cost (USD)', first(result.costUsd, result.provider?.costUsd)], ['Product evidence', result.productEvidence?.status], ['Verified product IDs', result.productEvidence?.productIds], ['Context product', result.contextProductId], ['Tenant context reset', result.contextResetForTenantChange], ['Trace ID', result.traceId]]);
      target.append(dl, details(result)); notify('Local test turn returned. Inspect its evidence and execution mode.');
    } finally { button.disabled = false; }
  }
  function bindForm(id, handler) { $(id).addEventListener('submit', event => { event.preventDefault(); Promise.resolve().then(handler).catch(error => notify(error.message, true)); }); }
  function bindButton(id, handler) { $(id).addEventListener('click', () => Promise.resolve().then(handler).catch(error => notify(error.message, true))); }
  bindForm('run-form', () => startRun('persona')); bindButton('run-full', () => startRun('full'));
  bindButton('load-scenarios', loadScenarios); bindButton('refresh-history', refreshHistory);
  $('scenario-search').addEventListener('input', renderScenarios);
  $('scenario-filter').addEventListener('change', renderScenarios);
  bindForm('comparison-form', compareRuns); bindForm('evidence-form', () => inspectEvidence($('evidence-id').value.trim())); bindForm('playground-form', playground);
  bindButton('reset-session', async () => {
    const id = $('session-id').value.trim(); if (!id) throw new Error('Enter a session ID to reset.');
    const result = await request(`/__lab/api/sessions/${encodeURIComponent(id)}/reset`, {});
    empty($('playground-results'), 'Session reset', 'The local API acknowledged the reset.');
    $('playground-results').append(details(result, 'Reset acknowledgment')); notify(`Session ${id} reset.`);
  });
  async function initialize() {
    const health = await request('/__lab/api/health'); state.health = health;
    $('service-status').textContent = `${text(health.service)} · ${text(health.status)}`;
    $('revision').textContent = `Revision ${text(health.revision)}`;
    const results = await Promise.allSettled([loadDataset(), refreshHistory()]);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new Error(failures.map(result => result.reason.message).join(' '));
  }
  bindButton('refresh-all', async () => { await initialize(); notify('Workspace metadata refreshed.'); });
  $('session-id').value = `lab-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36)}`;
  empty($('scenario-results'), 'Choose a persona', 'Load its ordered source metadata to begin reviewing.');
  empty($('replay-results'), 'No run selected', 'Create a run in Overview or open one from Run History.');
  empty($('evidence-results'), 'Choose a scenario', 'Use Scenario Explorer or enter a scenario ID above.');
  empty($('comparison-results'), 'Choose two recorded runs', 'Run provenance and scenario outcomes will appear side by side.');
  empty($('cost-results'), 'No measurement record selected', 'Open a recorded run to inspect available usage and timing.');
  empty($('triage-results'), 'No run selected', 'Recorded failures and safety decisions will appear here.');
  empty($('playground-results'), 'Waiting for a test turn', 'The local API will return a safe result and its evidence.');
  initialize().catch(error => { $('service-status').textContent = 'Lab unavailable or incomplete'; notify(error.message, true); });
  window.addEventListener('pagehide', stopPolling);
})();
