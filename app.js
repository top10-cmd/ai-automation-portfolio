import { LANGUAGES, CATEGORIES, URGENCY, SENTIMENT, STATUS, SAMPLES, AppError, mockAnalyze, newTicket, decide, snapshot } from './core.js';

const $ = s => document.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const languageName = code => LANGUAGES[code] || code;
const time = date => new Date(date).toLocaleString('ru-RU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const eventNames = { analyzed: 'Анализ завершён', edited: 'Правка сохранена', approved: 'Оператор подтвердил ответ', rejected: 'Ответ отклонён', delivery_retry: 'Повтор передачи', crm_accepted: 'CRM приняла событие', delivery_unconfirmed: 'Доставка не подтверждена' };
const storageKey = 'linguadesk.metadata.v2';
let config = null, active = null, history = [], busy = false;
const browserTickets = new Map();

function message(text = '') { $('#message').textContent = text; $('#message').hidden = !text; }
async function api(route, body) {
  const response = await fetch(`./api/${route}`, { method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Запрос не выполнен.');
  return data;
}
function setBusy(value) {
  busy = value;
  $('#analyze').disabled = value || !config;
  $('#analyze').textContent = value ? 'Обработка…' : 'Проанализировать обращение →';
  $('#export').disabled = value;
  $('#request-form').querySelectorAll('textarea, select, input, .sample').forEach(el => { el.disabled = value; });
  $('#result').querySelectorAll('button, textarea').forEach(el => { el.disabled = value; });
  $('#log').querySelectorAll('button').forEach(el => { el.disabled = value; });
  if (!value && active) renderTicket();
}
function saveBrowser(ticket) {
  const next = [snapshot(ticket), ...history.filter(r => r.id !== ticket.id)].slice(0, 500);
  // Failed persistence must not be presented as a successful approval.
  try { localStorage.setItem(storageKey, JSON.stringify(next)); }
  catch { throw new AppError(500, 'Браузер не разрешил сохранить журнал. Действие не подтверждено.'); }
  browserTickets.set(ticket.id, ticket);
  history = next.map(r => ({ ...r, available: browserTickets.has(r.id) }));
}
async function refreshHistory() {
  if (config.backend) history = (await api('logs')).records;
  renderHistory();
}
function renderHistory() {
  $('#total').textContent = `· ${history.length}`;
  if (!history.length) { $('#log').innerHTML = '<p class="empty">Обращений пока нет.</p>'; return; }
  $('#log').innerHTML = '<table><thead><tr><th>Обращение</th><th>Язык</th><th>Тема</th><th>Срочность</th><th>Статус</th><th></th></tr></thead><tbody>' + history.map(r =>
    `<tr><td>${escape(time(r.receivedAt))}<br><span class="small muted">${escape(r.id.slice(0, 8))}</span></td><td>${escape(languageName(r.languageCode))}</td><td>${escape(CATEGORIES[r.category])}</td><td>${escape(URGENCY[r.urgency])}</td><td>${escape(STATUS[r.status])}</td><td>${r.available ? `<button type="button" data-ticket="${escape(r.id)}">Открыть</button>` : '<span class="small muted">Архив</span>'}</td></tr>`).join('') + '</tbody></table>';
  $('#log').querySelectorAll('[data-ticket]').forEach(button => button.onclick = async () => {
    if (busy) return;
    if (active && $('#reply') && $('#reply').value !== active.draftReply) { message('Сначала сохраните правку текущего ответа.'); return; }
    setBusy(true); message();
    try { active = config.backend ? await api(`tickets/${button.dataset.ticket}`) : browserTickets.get(button.dataset.ticket); }
    catch (error) { message(error.message); }
    finally { setBusy(false); }
  });
}
function renderTicket() {
  const t = active;
  const editable = ['review', 'edited'].includes(t.status);
  $('#state').textContent = STATUS[t.status];
  $('#state').className = `badge ${['approved_demo', 'delivered'].includes(t.status) ? 'success' : t.status === 'delivery_failed' ? 'danger' : ''}`;
  $('#result').innerHTML = `<div class="meta"><div class="metric"><span>Язык</span><strong>${escape(languageName(t.languageCode))}</strong></div><div class="metric"><span>Тема</span><strong>${escape(CATEGORIES[t.category])}</strong></div><div class="metric"><span>Срочность</span><strong>${escape(URGENCY[t.urgency])}</strong></div><div class="metric"><span>Тональность</span><strong>${escape(SENTIMENT[t.sentiment])}</strong></div></div>
    ${t.needsReview ? '<p class="message warning">Есть неопределённость. Проверьте язык и содержание перед подтверждением.</p>' : ''}
    <div class="summary-box"><strong>Резюме для оператора · RU</strong>${escape(t.summaryRu)}</div>
    <label for="reply">Ответ клиенту · ${escape(languageName(t.languageCode))}</label><textarea id="reply" rows="6" maxlength="6000" dir="auto" ${editable ? '' : 'disabled'}>${escape(t.draftReply)}</textarea>
    <div class="actions">${editable ? `<button id="edit" class="secondary">Сохранить правку</button><button id="approve" class="send">${config.crmConfigured ? 'Подтвердить и передать в CRM' : 'Подтвердить · демо'}</button><button id="reject" class="reject">Отклонить</button>` : ''}${t.status === 'delivery_failed' ? '<button id="retry" class="secondary">Повторить передачу в CRM</button>' : ''}</div>
    <p class="ticket-note">${t.status === 'approved_demo' ? 'Подтверждение записано. Отправка клиенту не выполнялась.' : t.status === 'delivered' ? 'CRM приняла событие. Доставка сообщения клиенту зависит от CRM.' : t.status === 'delivery_failed' ? 'CRM не подтвердила приём. Перед повтором проверьте CRM: запрос мог дойти. Повтор использует тот же идентификатор события.' : config.crmConfigured ? 'Передача выполняется только после подтверждения оператором.' : 'Demo-режим: внешняя отправка отключена.'}</p>
    <div class="audit"><span class="small">История действий · ${escape(t.id.slice(0, 8))}</span><ol>${t.events.map(e => `<li>${escape(time(e.at))} — ${escape(eventNames[e.type] || e.type)}</li>`).join('')}</ol></div>`;
  if (editable) {
    $('#approve').disabled = !t.draftReply.trim();
    $('#reply').oninput = () => { $('#approve').disabled = !$('#reply').value.trim(); };
  }
  for (const decision of ['edit', 'approve', 'reject', 'retry']) {
    const button = $(`#${decision}`);
    if (button) button.onclick = () => act(decision);
  }
}
async function act(decision) {
  if (busy || !active) return;
  const body = { id: active.id, version: active.version, decision, reply: $('#reply').value };
  let failed = false;
  setBusy(true); message();
  try {
    if (config.backend) active = await api('approve', body);
    else { const next = decide(active, body); saveBrowser(next); active = next; }
    await refreshHistory();
  } catch (error) {
    failed = true;
    message(error.message || 'Сервис недоступен. Проверьте журнал перед повтором.');
    // A network timeout may hide a successful approval. Refetch authoritative state.
    if (config.backend) {
      try { active = await api(`tickets/${body.id}`); await refreshHistory(); } catch {}
    }
  } finally {
    setBusy(false);
    // Preserve a local draft on failure only if the server has not advanced.
    if (failed && active?.id === body.id && active.version === body.version && ['review', 'edited'].includes(active.status)) {
      $('#reply').value = body.reply;
      $('#approve').disabled = !body.reply.trim();
    }
  }
}
$('#input').oninput = () => { $('#count').textContent = `${$('#input').value.length} / 4000`; };
for (const [code, name] of Object.entries(LANGUAGES).filter(([c]) => c !== 'und')) {
  const option = document.createElement('option'); option.value = code; option.textContent = name; $('#language').append(option);
}
SAMPLES.forEach((sample, i) => {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'sample'; button.textContent = sample.title;
  button.onclick = () => { $('#input').value = sample.text; $('#input').oninput(); $('#language').value = ''; $('#synthetic').checked = true; };
  $(i < 4 ? '#samples' : '#more-samples').append(button);
});
$('#request-form').onsubmit = async e => {
  e.preventDefault();
  if (busy || !config) return;
  if (active && $('#reply') && $('#reply').value !== active.draftReply) { message('Сначала сохраните правку текущего ответа.'); return; }
  setBusy(true); message();
  try {
    const body = { text: $('#input').value, languageHint: $('#language').value, synthetic: $('#synthetic').checked };
    let ticket;
    if (config.backend) ticket = await api('analyze', body);
    else { ticket = newTicket(mockAnalyze(body.text, body.languageHint), 'mock'); saveBrowser(ticket); }
    active = ticket;
    await refreshHistory();
  } catch (error) { message(error.message || 'Не удалось связаться с сервером.'); }
  finally { setBusy(false); }
};
$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, records: history.map(snapshot) }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'linguadesk-journal.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
async function init() {
  setBusy(true);
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  try {
    if (local) {
      config = { ...(await api('health')), backend: true };
      $('#mode').textContent = config.mode === 'live' ? '● LIVE LLM' : '● DEMO / MOCK';
      $('#connection').textContent = config.mode === 'live' ? 'Live LLM: синтетический текст передаётся провайдеру. Результат всегда проходит проверку оператором.' : 'Локальный demo-сервер · шаблонный анализ · журнал сохраняется между запусками.';
    } else {
      config = { backend: false, mode: 'mock', crmConfigured: false };
      $('#mode').textContent = '● DEMO / MOCK';
      $('#connection').textContent = 'Автономная демонстрация · шаблонный анализ для 11 языков · внешняя отправка отключена.';
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (!Array.isArray(saved)) throw new Error('Не удалось прочитать локальный журнал.');
      history = saved.filter(r => r && typeof r.id === 'string' && Array.isArray(r.events) && Object.hasOwn(STATUS, r.status)).slice(0, 500).map(r => ({ ...r, available: false }));
    }
    await refreshHistory();
  } catch (error) { config = null; $('#mode').textContent = 'Нет подключения'; message(error.message || 'Сервер недоступен. Запустите node server.mjs и обновите страницу.'); }
  finally { setBusy(false); }
}
init();
