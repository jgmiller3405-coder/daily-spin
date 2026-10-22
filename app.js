'use strict';

const KEY = 'daily-spin-library';
const NEW_GENRES = ['Rock', 'Indie', 'Alternative', 'Pop', 'Hip-Hop', 'R&B', 'Soul', 'Jazz', 'Blues', 'Country', 'Folk',
  'Electronic', 'Dance', 'Metal', 'Punk', 'Classical', 'Reggae', 'Latin', 'Funk', 'Ambient'];
const MB_HEADERS = { Accept: 'application/json' };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let library = [];
try { library = JSON.parse(localStorage.getItem(KEY)) || []; } catch { library = []; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(library)); } catch { /* storage unavailable */ } };

// ---------- tabs ----------
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  window.scrollTo(0, 0);
}));

// ---------- library helpers ----------
const guessFormat = title => /\b(acoustic|unplugged|stripped)\b/i.test(title) ? 'Acoustic'
  : /\b(live|in concert|session)\b/i.test(title) ? 'Live' : 'Studio';

function makeAlbum(a) {
  const album = String(a.album || '').trim();
  const artist = String(a.artist || '').trim();
  if (!album || !artist) return null;
  return {
    id: (artist + '|' + album).toLowerCase(),
    artist, album,
    genre: String(a.genre || '').trim(),
    vocals: String(a.vocals || '').trim(),
    vibe: String(a.vibe || '').trim(),
    format: String(a.format || '').trim() || guessFormat(album),
    art: a.art || '', url: a.url || '',
  };
}

function addAlbums(list) {
  const have = new Set(library.map(a => a.id));
  let added = 0;
  for (const raw of list) {
    const a = makeAlbum(raw);
    if (a && !have.has(a.id)) { library.push(a); have.add(a.id); added++; }
  }
  save(); renderAll();
  return added;
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

function parseImport(text) {
  const t = text.trim();
  if (!t) return [];
  if (t[0] === '[' || t[0] === '{') {
    try {
      const j = JSON.parse(t);
      return (Array.isArray(j) ? j : j.library || []).map(x => ({ ...x, album: x.album ?? x.title, artist: x.artist ?? x.name }));
    } catch { /* fall through to text parsing */ }
  }
  const rows = parseCSV(t);
  const head = rows[0].map(h => h.trim().toLowerCase());
  if (head.includes('artist') && (head.includes('album') || head.includes('title'))) {
    return rows.slice(1).map(r => {
      const o = {};
      head.forEach((h, i) => { o[h === 'title' ? 'album' : h] = r[i]; });
      return o;
    });
  }
  // Plain lines: "Artist - Album" (also en/em dash or tab)
  return t.split(/\r?\n/).map(line => {
    const m = line.split(/\s+[-–—]\s+|\t/);
    return m.length >= 2 ? { artist: m[0], album: m.slice(1).join(' - ') } : null;
  }).filter(Boolean);
}

// ---------- rendering ----------
function tagsHTML(a) {
  return [a.genre, a.vocals && a.vocals + ' vocals', a.vibe, a.format !== 'Studio' && a.format].filter(Boolean)
    .map(t => `<span>${esc(t)}</span>`).join('');
}

function cardHTML(a, { edit = false, star = false, extra = '', add = '' } = {}) {
  const img = a.art ? `<img src="${esc(a.art)}" alt="" loading="lazy">` : '<div class="ph">💿</div>';
  const q = encodeURIComponent(a.artist + ' ' + a.album);
  const links = `<div class="links">
      <a href="${esc(a.url || 'https://music.apple.com/search?term=' + q)}" target="_blank" rel="noopener">Apple Music</a>
      <a href="https://open.spotify.com/search/${q}" target="_blank" rel="noopener">Spotify</a>
      ${edit ? `<button data-edit="${esc(a.id)}">Edit</button>` : ''}
      ${add ? `<button data-add="${esc(add)}">+ Library</button>` : ''}
    </div>`;
  return `<div class="album">${img}<div class="info">
      <div class="t">${star ? '★ ' : ''}${esc(a.album)}</div><div class="a">${esc(a.artist)}</div>
      <div class="tags">${tagsHTML(a)}${extra}</div>${links}</div></div>`;
}

function renderLibrary() {
  const q = $('search').value.trim().toLowerCase();
  const list = library.filter(a => !q || (a.artist + ' ' + a.album + ' ' + a.genre).toLowerCase().includes(q))
    .sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
  $('lib-count').textContent = library.length ? `(${library.length})` : '';
  $('lib-list').innerHTML = list.length ? list.map(a => cardHTML(a, { edit: true })).join('')
    : `<p class="hint">${library.length ? 'No matches.' : 'Your library is empty. Import albums above to get started.'}</p>`;
}

function renderAll() { renderLibrary(); }

// ---------- MusicBrainz ----------
let lastMB = Promise.resolve();
// Calls are queued and spaced out: MusicBrainz allows about one request per second.
function mb(path, params) {
  const run = async () => {
    const url = `https://musicbrainz.org/ws/2/${path}?fmt=json&` + new URLSearchParams(params);
    for (let attempt = 0; attempt < 2; attempt++) {
      await sleep(1100);
      const r = await fetch(url, { headers: MB_HEADERS });
      if (r.ok) return r.json();
      if (r.status !== 503) break;
    }
    throw new Error('MusicBrainz request failed');
  };
  const p = lastMB.then(run, run);
  lastMB = p.catch(() => {});
  return p;
}

function seeded(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let s = h >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- today: suggestions you don't own ----------
const GENRE_ALIAS = { 'hip-hop/rap': 'hip hop', 'hip-hop': 'hip hop', rap: 'hip hop', 'r&b/soul': 'r&b', 'singer/songwriter': 'singer-songwriter', electronica: 'electronic' };
const VOCAL_TAGS = { Male: ['male vocalists', 'male vocalist'], Female: ['female vocalists', 'female vocalist'], Instrumental: ['instrumental'], Mixed: [] };
const VIBE_TAGS = {
  Chill: ['chill', 'chillout', 'relaxing'], Mellow: ['mellow', 'calm', 'relaxing'], Groovy: ['groovy', 'groove', 'funky'],
  Upbeat: ['upbeat', 'happy', 'feel good'], Energetic: ['energetic', 'high energy', 'aggressive'], Dark: ['dark', 'atmospheric', 'gloomy'],
};
const SEEN_KEY = 'daily-spin-seen', MBID_KEY = 'daily-spin-mbid';

const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

const genreTags = g => {
  const k = g.toLowerCase().trim();
  if (GENRE_ALIAS[k]) return [GENRE_ALIAS[k]];
  return k.split('/').map(s => GENRE_ALIAS[s.trim()] || s.trim()).filter(Boolean);
};
const norm = s => String(s).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, '');
const orGroup = tags => '(' + tags.map(t => `tag:"${t}"`).join(' OR ') + ')';

$('f-genre').innerHTML = '<option value="">Any (my taste)</option>' + NEW_GENRES.map(g => `<option>${esc(g)}</option>`).join('');

function tasteWeights() {
  const w = {};
  for (const a of library) for (const t of genreTags(a.genre || '')) w[t] = (w[t] || 0) + 1;
  return w;
}

function weightedPick(weights, rnd) {
  const entries = Object.entries(weights);
  let r = rnd() * entries.reduce((s, [, v]) => s + v, 0);
  for (const [k, v] of entries) if ((r -= v) < 0) return k;
  return entries[0][0];
}

// Artists in your library that fit the filters, favouring artists you own more of.
function mineCandidates(f, genre, rnd) {
  const byArtist = new Map();
  for (const a of library) {
    if (genre && f.genre && !genreTags(a.genre || '').includes(genre)) continue;
    if (f.vocals && a.vocals && a.vocals !== f.vocals) continue;
    if (f.vibe && a.vibe && a.vibe !== f.vibe) continue;
    const e = byArtist.get(a.artist.toLowerCase()) || { name: a.artist, weight: 0 };
    e.weight++;
    byArtist.set(a.artist.toLowerCase(), e);
  }
  return [...byArtist.values()].map(e => ({ ...e, key: Math.pow(rnd(), 1 / e.weight) }))
    .sort((a, b) => b.key - a.key);
}

// Artists outside your library, tightest filter match first, then ranked by overlap with your taste.
async function newCandidates(f, genre, taste, rnd, exclude) {
  const parts = { vocals: VOCAL_TAGS[f.vocals] || [], vibe: VIBE_TAGS[f.vibe] || [] };
  const tiers = [];
  for (const keys of [['vocals', 'vibe'], ['vocals'], ['vibe'], []]) {
    const k = keys.filter(x => parts[x].length);
    if (!tiers.some(t => t.join() === k.join())) tiers.push(k);
  }
  const full = tiers[0];
  const pool = new Map();
  for (const [i, keys] of tiers.entries()) {
    const query = [`tag:"${genre}"`, ...keys.map(k => orGroup(parts[k]))].join(' AND ');
    const res = (await mb('artist', { query, limit: 100 })).artists || [];
    for (const a of res) {
      if (exclude.has(a.name.toLowerCase()) || pool.has(a.id)) continue;
      const tags = (a.tags || []).map(t => t.name);
      const tasteHits = tags.filter(t => taste[t]).length;
      pool.set(a.id, {
        id: a.id, name: a.name, loose: keys.length < full.length,
        score: (tiers.length - i) * 2 + Math.min(tasteHits, 4) + rnd() * 2.5,
      });
    }
    if (pool.size >= 15) break;
  }
  return [...pool.values()].sort((a, b) => b.score - a.score);
}

async function mbidFor(name) {
  const cache = readJSON(MBID_KEY, {});
  if (cache[name]) return cache[name];
  const res = (await mb('artist', { query: `artist:"${name.replace(/"/g, '')}"`, limit: 5 })).artists || [];
  const hit = res.find(a => a.name.toLowerCase() === name.toLowerCase());
  if (hit) { cache[name] = hit.id; writeJSON(MBID_KEY, cache); }
  return hit?.id || null;
}

async function albumFor(mbid, f, rnd, seen, owned) {
  const groups = (await mb('release-group', { artist: mbid, type: 'album', limit: 100 }))['release-groups'] || [];
  const cutoff = f.era ? new Date().getFullYear() - f.era : 0;
  const pool = groups.filter(g => !owned.has(norm(g.title)) && !seen.has(g.id) &&
    (!cutoff || +(g['first-release-date'] || '0').slice(0, 4) >= cutoff));
  const secondary = g => g['secondary-types'] || [];
  const studio = pool.filter(g => !secondary(g).length);
  let fit = studio, format = 'Studio', note = '';
  if (f.format === 'Live') fit = pool.filter(g => secondary(g).includes('Live')), format = 'Live';
  if (f.format === 'Acoustic') fit = pool.filter(g => /acoustic|unplugged|stripped/i.test(g.title)), format = 'Acoustic';
  if (!fit.length && (f.format === 'Live' || f.format === 'Acoustic')) {
    fit = studio; format = 'Studio'; note = `no ${f.format.toLowerCase()} album found`;
  }
  if (!fit.length) return null;
  const g = fit[Math.floor(rnd() * fit.length)];
  return { rg: g, format, note };
}

let runId = 0;
const suggested = new Map();

async function generate() {
  const run = ++runId;
  const f = {
    genre: $('f-genre').value, vocals: $('f-vocals').value, vibe: $('f-vibe').value, format: $('f-format').value,
    source: $('f-source').value, era: +$('f-era').value,
  };
  const n = +$('f-count').value;
  const rnd = seeded(String(Date.now()));
  const out = $('picks'), status = $('gen-status');
  const taste = tasteWeights();
  const seen = new Set(readJSON(SEEN_KEY, []));
  const ownedByArtist = new Map();
  for (const a of library) {
    const k = norm(a.artist);
    if (!ownedByArtist.has(k)) ownedByArtist.set(k, new Set());
    ownedByArtist.get(k).add(norm(a.album));
  }
  const ownedFor = name => ownedByArtist.get(norm(name)) || new Set();
  const genre = f.genre ? genreTags(f.genre)[0]
    : Object.keys(taste).length ? weightedPick(taste, rnd) : genreTags(NEW_GENRES[Math.floor(rnd() * NEW_GENRES.length)])[0];

  out.className = n === 1 ? 'big' : '';
  out.innerHTML = '';
  suggested.clear();
  $('generate').disabled = true;
  const picks = [];

  const gather = async (list, want, kind) => {
    while (picks.length < want && (list.pos || 0) < list.length && (list.tries || 0) < want * 4 + 3) {
      if (run !== runId) return;
      const c = list[list.pos++ || 0];
      list.tries = (list.tries || 0) + 1;
      status.textContent = `Looking through ${kind === 'mine' ? 'artists you like' : genre + ' artists'}… (${picks.length}/${n})`;
      const mbid = kind === 'mine' ? await mbidFor(c.name) : c.id;
      if (!mbid) continue;
      const found = await albumFor(mbid, f, rnd, seen, ownedFor(c.name));
      if (!found || run !== runId) continue;
      const g = found.rg, year = (g['first-release-date'] || '').slice(0, 4);
      const album = {
        id: g.id, artist: c.name, album: g.title, genre: kind === 'new' ? genre : '', vocals: '', vibe: '',
        format: found.format, art: `https://coverartarchive.org/release-group/${g.id}/front-250`, url: '',
      };
      suggested.set(g.id, album);
      picks.push(album);
      seen.add(g.id);
      const extra = [year, kind === 'mine' ? '★ your artist' : 'new artist', c.loose && 'loose match', found.note]
        .filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('');
      out.insertAdjacentHTML('beforeend', cardHTML(album, { extra, add: g.id }));
      out.lastElementChild.querySelector('img')?.addEventListener('error', e => {
        const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = '💿'; e.target.replaceWith(ph);
      });
    }
  };

  try {
    const mine = f.source === 'new' ? [] : mineCandidates(f, genre, rnd);
    const wantMine = f.source === 'mine' ? n : f.source === 'new' || !mine.length ? 0
      : n === 1 ? +(rnd() < 0.5) : Math.floor(n / 2);
    if (wantMine) await gather(mine, wantMine, 'mine');
    if (picks.length < n && f.source !== 'mine') {
      status.textContent = `Searching ${genre} artists you haven't heard…`;
      const fresh = await newCandidates(f, genre, taste, rnd, new Set(library.map(a => a.artist.toLowerCase())));
      await gather(fresh, n, 'new');
    }
    if (picks.length < n && f.source !== 'new') await gather(mine, n, 'mine');
  } catch {
    status.textContent = 'Couldn\'t reach the music database. Check your connection and try again.';
    $('generate').disabled = false;
    return;
  }
  if (run !== runId) return;
  writeJSON(SEEN_KEY, [...seen].slice(-150));
  $('generate').disabled = false;
  const why = f.genre ? genre : `${genre} (from your library)`;
  status.textContent = picks.length
    ? `${picks.length} pick(s) · genre: ${why}`
    : f.source === 'mine'
      ? 'Nothing found from your library. Run "Auto-fill genre" in the Library tab, or loosen the filters.'
      : 'Nothing matched. Try loosening vibe, vocals, format or era.';
}

$('generate').addEventListener('click', generate);
$('picks').addEventListener('click', e => {
  const a = suggested.get(e.target.dataset.add);
  if (!a) return;
  addAlbums([a]);
  e.target.textContent = 'Added ✓';
  e.target.disabled = true;
});

// ---------- import / export / enrich ----------
function setStatus(msg) { $('status').textContent = msg; }

$('import-btn').addEventListener('click', () => {
  const found = parseImport($('import-text').value);
  const added = addAlbums(found);
  setStatus(found.length ? `Added ${added} new album(s) (${found.length - added} duplicates skipped).` : 'Nothing recognised. Use "Artist - Album" per line.');
  if (added) $('import-text').value = '';
});

$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const found = parseImport(await file.text());
  const added = addAlbums(found);
  setStatus(`Read ${found.length} row(s) from ${file.name}; added ${added} new.`);
  e.target.value = '';
});

$('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(library, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'daily-spin-library.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

$('clear-btn').addEventListener('click', () => {
  if (confirm('Delete every album in your library?')) { library = []; save(); renderAll(); }
});

let enriching = false;
$('enrich-btn').addEventListener('click', async () => {
  if (enriching) return;
  enriching = true;
  const todo = library.filter(a => !a.art || !a.genre);
  let done = 0, hit = 0;
  for (const a of todo) {
    setStatus(`Looking up ${++done} of ${todo.length}…`);
    try {
      const url = 'https://itunes.apple.com/search?entity=album&limit=1&term=' + encodeURIComponent(a.artist + ' ' + a.album);
      const r = (await (await fetch(url)).json()).results?.[0];
      if (r) {
        a.art ||= (r.artworkUrl100 || '').replace('100x100', '300x300');
        a.url ||= r.collectionViewUrl || '';
        a.genre ||= r.primaryGenreName || '';
        hit++;
      }
    } catch { setStatus('Lookup failed. Check your connection and try again.'); break; }
    if (done % 10 === 0) { save(); renderAll(); }
    await sleep(350); // iTunes throttles rapid-fire requests
  }
  save(); renderAll(); enriching = false;
  if (done === todo.length) setStatus(`Done. Matched ${hit} of ${todo.length}.`);
});

// ---------- editor ----------
let editing = null;
$('lib-list').addEventListener('click', e => {
  const id = e.target.dataset.edit;
  if (!id) return;
  editing = library.find(a => a.id === id);
  $('e-title').textContent = `${editing.album} — ${editing.artist}`;
  $('e-genre').value = editing.genre; $('e-vocals').value = editing.vocals;
  $('e-vibe').value = editing.vibe; $('e-format').value = editing.format;
  $('editor').showModal();
});
$('editor').addEventListener('close', () => {
  const v = $('editor').returnValue;
  if (editing && v === 'save') {
    Object.assign(editing, { genre: $('e-genre').value.trim(), vocals: $('e-vocals').value, vibe: $('e-vibe').value, format: $('e-format').value });
  } else if (editing && v === 'delete') {
    library = library.filter(a => a !== editing);
  }
  if (v === 'save' || v === 'delete') { save(); renderAll(); }
  editing = null;
});
$('search').addEventListener('input', renderLibrary);

// ---------- new music (MusicBrainz + Cover Art Archive) ----------
$('n-genre').innerHTML = NEW_GENRES.map(g => `<option>${esc(g)}</option>`).join('');
const ymd = d => d.toISOString().slice(0, 10);

$('n-load').addEventListener('click', async () => {
  const out = $('n-results');
  const genre = $('n-genre').value.toLowerCase();
  const to = new Date(), from = new Date(Date.now() - $('n-days').value * 864e5);
  const query = `tag:"${genre}" AND primarytype:album AND firstreleasedate:[${ymd(from)} TO ${ymd(to)}]`;
  out.innerHTML = '<p class="hint">Searching…</p>';
  try {
    const r = await fetch('https://musicbrainz.org/ws/2/release-group?fmt=json&limit=40&query=' + encodeURIComponent(query), { headers: MB_HEADERS });
    if (!r.ok) throw new Error(r.status);
    const groups = (await r.json())['release-groups'] || [];
    const mine = new Set(library.map(a => a.artist.toLowerCase()));
    const items = groups
      .filter(g => !(g['secondary-types'] || []).length)
      .map(g => {
        const artist = (g['artist-credit'] || []).map(c => c.name + (c.joinphrase || '')).join('');
        return {
          id: g.id, album: g.title, artist, date: g['first-release-date'] || '',
          art: `https://coverartarchive.org/release-group/${g.id}/front-250`,
          star: mine.has(artist.toLowerCase()),
        };
      })
      .sort((a, b) => b.star - a.star || b.date.localeCompare(a.date));
    out.innerHTML = items.length
      ? items.map(a => cardHTML({ ...a, genre: '', vocals: '', vibe: '', format: 'Studio' }, { star: a.star, extra: `<span>${esc(a.date)}</span>` })).join('')
      : '<p class="hint">No releases found. Try a longer window or another genre.</p>';
    // Not every release has cover art; swap in the placeholder when it's missing.
    out.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
      const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = '💿'; img.replaceWith(ph);
    }));
  } catch {
    out.innerHTML = '<p class="hint">Couldn\'t load new releases. Check your connection and try again in a moment.</p>';
  }
});

renderAll();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
