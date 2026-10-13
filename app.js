'use strict';

/* ==========================================================
   Aktivitetskoll
   En deltagare har ett mål (timmar) och en eller flera
   aktiviteter. Aktiviteternas timmar räknas ihop mot målet.

   Data: { id, name, targetHours, activities: [{ id, name, hours }] }
   ========================================================== */

const STORAGE_KEY = 'participants';                        // samma nyckel som tidigare version
const BACKUP_KEY = 'participants_backup_fore_flera_aktiviteter';
const IMPORT_BACKUP_KEY = 'participants_backup_fore_import';
const THEME_KEY = 'aktivitetskoll_tema';
const PART_COLORS = 6;

/* ---------- Lagring (tål att localStorage inte är tillgängligt) ---------- */

function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}

/* ---------- Tema (körs direkt, före första målning) ---------- */

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById('themeToggle');
    if (btn) btn.setAttribute('aria-pressed', String(theme === 'dark'));
}

applyTheme(storageGet(THEME_KEY) || (systemDark.matches ? 'dark' : 'light'));

// Följ systemets val så länge användaren inte själv valt tema
systemDark.addEventListener('change', e => {
    if (!storageGet(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
});

/* ---------- Hjälpfunktioner ---------- */

const $ = sel => document.querySelector(sel);
const round2 = n => Math.round(n * 100) / 100;
const numberFormat = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 });
const fmtH = n => numberFormat.format(n);
const timmar = n => `${fmtH(n)} ${n === 1 ? 'timme' : 'timmar'}`;

function uid() {
    return (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function esc(value) {
    return String(value).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

const activityKey = name => name.trim().toLocaleLowerCase('sv');

/* ---------- Datamodell ---------- */

let participants = [];
let editingId = null;      // id på deltagaren som redigeras, null = ny
let activeFilter = 'all';  // all | below | met

// Läser både nytt format (activities[]) och äldre format (activity + currentHours)
function normalizeParticipant(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    let activities;

    if (Array.isArray(r.activities)) {
        activities = r.activities.map(a => {
            const x = a && typeof a === 'object' ? a : {};
            return {
                id: x.id ?? uid(),
                name: String(x.name ?? '').trim(),
                hours: round2(Math.max(0, Number(x.hours) || 0))
            };
        });
    } else {
        const name = String(r.activity ?? '').trim();
        const hrs = Math.max(0, Number(r.currentHours) || 0);
        activities = (name || hrs)
            ? [{ id: uid(), name: name || 'Aktivitet', hours: round2(hrs) }]
            : [];
    }

    return {
        id: r.id ?? uid(),
        name: String(r.name ?? '').trim(),
        targetHours: Math.max(0, Number(r.targetHours) || 0),
        activities
    };
}

function loadParticipants() {
    const raw = storageGet(STORAGE_KEY);
    if (!raw) return [];

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        if (!storageGet(BACKUP_KEY)) storageSet(BACKUP_KEY, raw);
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    // Äldre data konverteras en gång; originalet sparas först som säkerhetskopia
    const needsMigration = parsed.some(p => !p || !Array.isArray(p.activities));
    if (needsMigration && !storageGet(BACKUP_KEY)) storageSet(BACKUP_KEY, raw);

    const list = parsed.map(normalizeParticipant);
    if (needsMigration) persist(list);
    return list;
}

function persist(list = participants) {
    if (!storageSet(STORAGE_KEY, JSON.stringify(list))) {
        toast('Kunde inte spara i webbläsaren. Exportera data så att inget går förlorat.');
    }
}

function summarize(p) {
    const total = round2(p.activities.reduce((sum, a) => sum + a.hours, 0));
    const remaining = round2(Math.max(0, p.targetHours - total));
    const over = round2(Math.max(0, total - p.targetHours));
    return { total, remaining, over, met: remaining === 0 };
}

// Samma aktivitetsnamn får samma färg hos alla deltagare
function buildColorMap() {
    const map = new Map();
    for (const p of participants) {
        for (const a of p.activities) {
            const key = activityKey(a.name);
            if (!map.has(key)) map.set(key, map.size % PART_COLORS);
        }
    }
    return map;
}

/* ---------- Rendering ---------- */

const ICON_CHECK = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_ALERT = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 4.8v3.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.1" r="1" fill="currentColor"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function leadText(total, below, deficit) {
    if (total === 0) return 'Inga deltagare ännu.';
    if (below === 0) {
        return total === 1 ? 'Deltagaren har nått målet.' : `Alla ${total} deltagare har nått målet.`;
    }
    if (total === 1) return `Deltagaren är under mål och saknar ${timmar(deficit)}.`;
    return `${below} av ${total} deltagare är under mål. Totalt saknas ${timmar(deficit)}.`;
}

function rowHtml({ p, s }, colors) {
    const colorOf = a => colors.get(activityKey(a.name)) ?? 0;
    const withHours = p.activities.filter(a => a.hours > 0);

    const parts = withHours.map(a =>
        `<span class="part" style="flex-grow:${a.hours};background:var(--part-${colorOf(a)})" title="${esc(a.name)}: ${fmtH(a.hours)} h"></span>`
    ).join('');

    const gap = s.remaining > 0
        ? `<span class="gap" style="flex-grow:${s.remaining}" title="${fmtH(s.remaining)} h kvar"></span>`
        : '';

    const meterLabel = (withHours.length
        ? withHours.map(a => `${a.name} ${fmtH(a.hours)} h`).join(', ')
        : 'Inga timmar registrerade') + `. Mål ${fmtH(p.targetHours)} h.`;

    const status = s.met
        ? `<span class="status ok">${ICON_CHECK}Godkänt${s.over > 0 ? `, ${fmtH(s.over)} h över` : ''}</span>`
        : `<span class="status warn">${ICON_ALERT}${fmtH(s.remaining)} h kvar</span>`;

    const legend = p.activities.length
        ? p.activities.map(a =>
            `<li><span class="swatch" style="background:var(--part-${colorOf(a)})" aria-hidden="true"></span>${esc(a.name)} <span class="num">${fmtH(a.hours)} h</span></li>`
        ).join('')
        : '<li class="muted">Ingen aktivitet registrerad</li>';

    return `
        <li class="p">
            <div class="p-head">
                <h3 class="p-name">${esc(p.name)}</h3>
                <span class="p-hours num">${fmtH(s.total)} / ${fmtH(p.targetHours)} h</span>
                ${status}
                <button type="button" class="btn btn-quiet btn-sm" data-action="edit"
                        data-id="${esc(String(p.id))}" aria-label="Ändra ${esc(p.name)}">Ändra</button>
            </div>
            <div class="meter" role="img" aria-label="${esc(meterLabel)}">${parts}${gap}</div>
            <ul class="legend">${legend}</ul>
        </li>`;
}

function render() {
    const colors = buildColorMap();
    const query = $('#searchInput').value.trim().toLocaleLowerCase('sv');
    const sort = $('#sortSelect').value;

    const rows = participants.map(p => ({ p, s: summarize(p) }));

    // Helhetsstatistik gäller alla deltagare, oavsett sök och filter
    const below = rows.filter(r => !r.s.met).length;
    const deficit = round2(rows.reduce((sum, r) => sum + r.s.remaining, 0));

    $('#lead').textContent = leadText(rows.length, below, deficit);
    $('#countAll').textContent = rows.length;
    $('#countBelow').textContent = below;
    $('#countMet').textContent = rows.length - below;

    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.setAttribute('aria-pressed', String(btn.dataset.filter === activeFilter));
    });

    const visible = rows.filter(({ p, s }) => {
        if (activeFilter === 'below' && s.met) return false;
        if (activeFilter === 'met' && !s.met) return false;
        if (!query) return true;
        return p.name.toLocaleLowerCase('sv').includes(query)
            || p.activities.some(a => a.name.toLocaleLowerCase('sv').includes(query));
    });

    const byName = (a, b) => a.p.name.localeCompare(b.p.name, 'sv');
    visible.sort(sort === 'remaining'
        ? (a, b) => (b.s.remaining - a.s.remaining) || byName(a, b)
        : byName);

    const list = $('#participantList');
    if (rows.length === 0) {
        list.innerHTML = `
            <li class="empty">
                <p>Inga deltagare ännu.</p>
                <p class="hint">Lägg till en deltagare och de aktiviteter som ska räknas mot målet.</p>
                <button type="button" class="btn btn-primary" data-action="new">Ny deltagare</button>
            </li>`;
    } else if (visible.length === 0) {
        list.innerHTML = `
            <li class="empty">
                <p>Inga deltagare matchar.</p>
                <p class="hint">Ändra sökningen eller filtret.</p>
            </li>`;
    } else {
        list.innerHTML = visible.map(r => rowHtml(r, colors)).join('');
    }

    refreshActivityNames();
}

function refreshActivityNames() {
    const seen = new Map();
    for (const p of participants) {
        for (const a of p.activities) {
            const key = activityKey(a.name);
            if (a.name && !seen.has(key)) seen.set(key, a.name);
        }
    }
    $('#activityNames').innerHTML = [...seen.values()]
        .sort((a, b) => a.localeCompare(b, 'sv'))
        .map(name => `<option value="${esc(name)}"></option>`)
        .join('');
}

/* ---------- Dialog: lägg till / ändra deltagare ---------- */

function addActivityRow(activity = { name: '', hours: '' }, focus = false) {
    const row = document.createElement('div');
    row.className = 'act-row';
    if (activity.id) row.dataset.id = activity.id;

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'act-name';
    name.setAttribute('aria-label', 'Aktivitet');
    name.setAttribute('list', 'activityNames');
    name.autocomplete = 'off';
    name.placeholder = 'T.ex. Språkkurs';
    name.value = activity.name;
    name.addEventListener('input', () => name.setCustomValidity(''));

    const hrs = document.createElement('input');
    hrs.type = 'number';
    hrs.className = 'act-hours';
    hrs.setAttribute('aria-label', 'Timmar');
    hrs.min = '0';
    hrs.step = 'any';
    hrs.inputMode = 'decimal';
    hrs.placeholder = '0';
    hrs.value = activity.hours === '' ? '' : activity.hours;
    hrs.addEventListener('input', updateDialogSum);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn icon-btn-quiet';
    remove.dataset.action = 'remove-activity';
    remove.setAttribute('aria-label', 'Ta bort aktivitet');
    remove.title = 'Ta bort aktivitet';
    remove.innerHTML = ICON_CLOSE;

    row.append(name, hrs, remove);
    $('#activityRows').append(row);
    if (focus) name.focus();
}

function updateDialogSum() {
    const target = parseFloat($('#targetInput').value) || 0;
    const total = round2([...document.querySelectorAll('#activityRows .act-hours')]
        .reduce((sum, el) => sum + (parseFloat(el.value) || 0), 0));
    const remaining = round2(Math.max(0, target - total));

    const el = $('#dialogSum');
    el.className = 'sum ' + (remaining > 0 ? 'warn' : 'ok');
    el.textContent = remaining > 0
        ? `Summa ${fmtH(total)} av ${fmtH(target)} h, ${fmtH(remaining)} h kvar`
        : `Summa ${fmtH(total)} av ${fmtH(target)} h, målet är uppnått`;
}

function openDialog(participant) {
    editingId = participant ? String(participant.id) : null;

    $('#dialogTitle').textContent = participant ? 'Ändra deltagare' : 'Ny deltagare';
    $('#nameInput').value = participant ? participant.name : '';
    $('#targetInput').value = participant ? participant.targetHours : 40;
    $('#deleteBtn').hidden = !participant;

    $('#activityRows').innerHTML = '';
    const activities = participant && participant.activities.length
        ? participant.activities
        : [{ name: '', hours: '' }];
    activities.forEach(a => addActivityRow(a));

    updateDialogSum();
    $('#participantDialog').showModal();
}

function onSubmit(event) {
    event.preventDefault();

    const activities = [];
    for (const row of document.querySelectorAll('#activityRows .act-row')) {
        const nameEl = row.querySelector('.act-name');
        const hoursEl = row.querySelector('.act-hours');
        const name = nameEl.value.trim();
        const hrs = parseFloat(hoursEl.value);
        const hasHours = Number.isFinite(hrs) && hrs > 0;

        if (!name && !hasHours) continue;   // tom rad hoppas över

        if (!name) {
            nameEl.setCustomValidity('Ange ett namn på aktiviteten.');
            nameEl.reportValidity();
            return;
        }
        activities.push({ id: row.dataset.id || uid(), name, hours: hasHours ? round2(hrs) : 0 });
    }

    const data = {
        name: $('#nameInput').value.trim(),
        targetHours: Math.max(0, parseFloat($('#targetInput').value) || 0),
        activities
    };

    const existing = editingId && participants.find(p => String(p.id) === editingId);
    if (existing) {
        Object.assign(existing, data);
    } else {
        participants.push({ id: uid(), ...data });
    }

    persist();
    render();
    $('#participantDialog').close();
    toast(existing ? 'Ändringarna är sparade.' : 'Deltagaren är tillagd.');
}

function deleteEditing() {
    const p = participants.find(x => String(x.id) === editingId);
    if (!p) return;
    if (!confirm(`Ta bort ${p.name}? Det går inte att ångra.`)) return;

    participants = participants.filter(x => x !== p);
    persist();
    render();
    $('#participantDialog').close();
    toast('Deltagaren är borttagen.');
}

/* ---------- Export / import ---------- */

function exportData() {
    const blob = new Blob([JSON.stringify(participants, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aktivitetskoll_backup_${new Date().toLocaleDateString('sv-SE')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onImportFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    try {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed)) throw new Error('Fel format');

        // Läser både nya filer och exporter från den äldre versionen
        const list = parsed.map(normalizeParticipant).filter(p => p.name);
        if (!confirm(`Importen ersätter nuvarande data med ${list.length} deltagare. Fortsätta?`)) return;

        storageSet(IMPORT_BACKUP_KEY, JSON.stringify(participants));
        participants = list;
        persist();
        render();
        toast(`${list.length} deltagare importerade.`);
    } catch (e) {
        toast('Kunde inte läsa filen. Välj en JSON-fil som exporterats från Aktivitetskoll.');
    }
}

/* ---------- Meddelande ---------- */

let toastTimer;

function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

/* ---------- Händelser ---------- */

function onClick(event) {
    const filterBtn = event.target.closest('[data-filter]');
    if (filterBtn) {
        activeFilter = filterBtn.dataset.filter;
        render();
        return;
    }

    const el = event.target.closest('[data-action]');
    if (!el) return;

    switch (el.dataset.action) {
        case 'new':
            openDialog(null);
            break;
        case 'edit': {
            const p = participants.find(x => String(x.id) === el.dataset.id);
            if (p) openDialog(p);
            break;
        }
        case 'add-activity':
            addActivityRow(undefined, true);
            updateDialogSum();
            break;
        case 'remove-activity':
            el.closest('.act-row').remove();
            updateDialogSum();
            break;
        case 'cancel':
            $('#participantDialog').close();
            break;
        case 'delete':
            deleteEditing();
            break;
        case 'toggle-theme': {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            storageSet(THEME_KEY, next);
            break;
        }
        case 'export':
            exportData();
            break;
        case 'import':
            $('#importFile').click();
            break;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    applyTheme(document.documentElement.dataset.theme);   // synka knappens läge
    participants = loadParticipants();

    $('#searchInput').addEventListener('input', render);
    $('#sortSelect').addEventListener('change', render);
    $('#targetInput').addEventListener('input', updateDialogSum);
    $('#participantForm').addEventListener('submit', onSubmit);
    $('#importFile').addEventListener('change', onImportFile);
    document.addEventListener('click', onClick);

    render();
});
