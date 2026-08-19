// 오늘의 공기 — 애플리케이션 진입점 (빌드 없는 ES 모듈)

import {
  SIDO_ORDER, SIDO_FULL_NAME, GRADES, gradeOf, overallGradeOf,
  UNIT, STALE_AFTER_MS, POLL_INTERVAL_MS, DATA_URL,
} from './config.js';
import { KOREA_MAP } from './map-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ 상태 */

const state = {
  payload: null,      // air.json 원본
  regions: null,      // { 서울: {pm10, pm25, stations, ...} }
  selected: '서울',    // 기본 선택 지역
  metric: 'pm25',     // 랭킹 기준
  dir: 'asc',         // asc = 좋은 순
  expanded: false,    // 모바일 랭킹 전체 보기
  loading: true,
  error: null,
};

const el = {};
const MOBILE_RANK_LIMIT = 5;

/* -------------------------------------------------------------- 유틸리티 */

function regionOf(sido) {
  return state.regions?.[sido] ?? null;
}

function valueOf(sido, metric) {
  const r = regionOf(sido);
  const v = r?.[metric];
  return Number.isFinite(v) ? v : null;
}

function gradeKeyOf(sido) {
  const r = regionOf(sido);
  return r ? overallGradeOf(r) : 'none';
}

function fmtValue(v) {
  return v === null ? '—' : String(Math.round(v));
}

function fmtClock(isoOrText) {
  if (!isoOrText) return '—';
  const d = new Date(isoOrText.includes('T') ? isoOrText : isoOrText.replace(' ', 'T') + ':00');
  if (Number.isNaN(d.getTime())) return isoOrText;
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

function isStale() {
  const at = state.payload?.fetchedAt;
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && Date.now() - t > STALE_AFTER_MS;
}

/* ------------------------------------------------------------ 데이터 로딩 */

async function load({ silent = false } = {}) {
  if (!silent) {
    state.loading = true;
    render();
  }
  el.refresh.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json?.regions) throw new Error('형식이 올바르지 않습니다');
    state.payload = json;
    state.regions = json.regions;
    state.error = null;
  } catch (err) {
    // 이전에 받아 둔 데이터가 있으면 지우지 않는다 — 흐린 채로 유지하고 배너만 띄운다.
    state.error = err.message ?? '알 수 없는 오류';
  } finally {
    state.loading = false;
    el.refresh.removeAttribute('aria-busy');
    render();
  }
}

/* ---------------------------------------------------------------- 선택 */

function select(sido, { scrollChip = false } = {}) {
  if (!SIDO_ORDER.includes(sido)) return;
  state.selected = sido;
  try { localStorage.setItem('todayair:last', sido); } catch { /* 무시 */ }
  // 공유 가능한 URL 유지 (?sido=충남). 히스토리를 쌓지 않도록 replaceState 를 쓴다.
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('sido', sido);
    window.history.replaceState(null, '', url);
  } catch { /* 무시 */ }
  render();
  if (scrollChip) {
    const chip = el.chips.querySelector(`[data-sido="${sido}"]`);
    chip?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
}

/* ------------------------------------------------------------- 칩 렌더링 */

function buildChips() {
  el.chips.replaceChildren(
    ...SIDO_ORDER.map((sido) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.sido = sido;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `<span class="swatch"></span><span class="name">${sido}</span>`;
      b.addEventListener('click', () => select(sido));
      return b;
    }),
  );

  // 키보드: ←/→ 로 칩 이동 (roving tabindex)
  el.chips.addEventListener('keydown', (e) => {
    const keys = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = SIDO_ORDER.indexOf(state.selected);
    let next;
    if (keys[e.key] === 'first') next = 0;
    else if (keys[e.key] === 'last') next = SIDO_ORDER.length - 1;
    else next = (i + keys[e.key] + SIDO_ORDER.length) % SIDO_ORDER.length;
    select(SIDO_ORDER[next], { scrollChip: true });
    el.chips.querySelector(`[data-sido="${SIDO_ORDER[next]}"]`)?.focus();
  });
}

function renderChips() {
  for (const b of el.chips.children) {
    const sido = b.dataset.sido;
    const g = GRADES[gradeKeyOf(sido)];
    const on = sido === state.selected;
    b.setAttribute('aria-pressed', String(on));
    b.tabIndex = on ? 0 : -1;
    b.querySelector('.swatch').style.background = g.color;
    b.setAttribute('aria-label', `${SIDO_FULL_NAME[sido]} ${g.label}`);
  }
}

/* ------------------------------------------------------------ 상세 카드 */

function renderDetail() {
  const sido = state.selected;
  const r = regionOf(sido);
  const gKey = gradeKeyOf(sido);
  const g = GRADES[gKey];

  el.detailRegion.textContent = SIDO_FULL_NAME[sido] ?? sido;

  el.detailGrade.style.background = g.color;
  el.detailGrade.style.color = g.onColor;
  el.detailGrade.querySelector('.icon').textContent = g.icon;
  el.detailGrade.querySelector('.txt').textContent = g.label;

  el.detailAdvice.textContent = g.advice;

  if (r && (r.pm10Stations || r.pm25Stations)) {
    const n = Math.max(r.pm10Stations ?? 0, r.pm25Stations ?? 0);
    el.detailSub.textContent = `${sido} 지역 ${n}개 측정소 평균 · 기준 ${fmtClock(state.payload?.dataTime)}`;
  } else {
    el.detailSub.textContent = state.loading ? ' ' : '유효한 측정값이 없습니다';
  }

  const set = (metric, valueNode, gradeNode) => {
    const v = valueOf(sido, metric);
    const key = gradeOf(metric, v);
    valueNode.textContent = fmtValue(v);
    gradeNode.textContent = GRADES[key].label;
    gradeNode.style.color = key === 'none' ? 'var(--ink-muted)' : GRADES[key].color;
  };
  set('pm10', el.pm10Value, el.pm10Grade);
  set('pm25', el.pm25Value, el.pm25Grade);
}

/* ---------------------------------------------------------------- 지도 */

function buildMap() {
  const svg = el.map;
  svg.setAttribute('viewBox', KOREA_MAP.viewBox);
  svg.setAttribute('aria-label', '전국 시·도별 미세먼지 등급 지도');
  const labelled = new Set(KOREA_MAP.labelled);

  const frag = document.createDocumentFragment();

  for (const sido of SIDO_ORDER) {
    const d = KOREA_MAP.paths[sido];
    const a = KOREA_MAP.anchors[sido];
    if (!d || !a) continue;

    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('region-group');
    g.dataset.sido = sido;
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.classList.add('region-shape');
    g.appendChild(path);

    if (labelled.has(sido)) {
      // 면적이 큰 시·도: 이름 + 수치를 지도 위에 직접 표기 (색 단독 인코딩 금지)
      const name = document.createElementNS(SVG_NS, 'text');
      name.setAttribute('x', a.x);
      name.setAttribute('y', a.y - 2);
      name.classList.add('map-label');
      name.textContent = sido;

      const val = document.createElementNS(SVG_NS, 'text');
      val.setAttribute('x', a.x);
      val.setAttribute('y', a.y + 13);
      val.classList.add('map-label', 'map-value');
      val.dataset.role = 'value';

      g.append(name, val);
    } else {
      // 작은 광역시: 최소 44px 상당의 원형 히트 타깃 + 값 버블
      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.setAttribute('cx', a.x);
      hit.setAttribute('cy', a.y);
      hit.setAttribute('r', '15');
      hit.classList.add('region-hit');
      g.appendChild(hit);

      const bubble = document.createElementNS(SVG_NS, 'circle');
      bubble.setAttribute('cx', a.x);
      bubble.setAttribute('cy', a.y);
      bubble.setAttribute('r', '12.5');
      bubble.classList.add('map-bubble');

      const name = document.createElementNS(SVG_NS, 'text');
      name.setAttribute('x', a.x);
      name.setAttribute('y', a.y - 2);
      name.classList.add('map-label');
      name.style.fontSize = '8px';
      name.style.strokeWidth = '0';
      name.textContent = sido;

      const val = document.createElementNS(SVG_NS, 'text');
      val.setAttribute('x', a.x);
      val.setAttribute('y', a.y + 8);
      val.classList.add('map-label', 'map-value');
      val.style.fontSize = '9px';
      val.style.strokeWidth = '0';
      val.dataset.role = 'value';

      g.append(bubble, name, val);
    }

    const title = document.createElementNS(SVG_NS, 'title');
    title.dataset.role = 'title';
    g.insertBefore(title, g.firstChild);

    g.addEventListener('click', () => select(sido, { scrollChip: true }));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(sido, { scrollChip: true }); }
    });
    g.addEventListener('pointerenter', (e) => showTooltip(sido, e));
    g.addEventListener('pointermove', (e) => moveTooltip(e));
    g.addEventListener('pointerleave', hideTooltip);

    frag.appendChild(g);
  }

  svg.replaceChildren(frag);
}

function renderMap() {
  for (const g of el.map.children) {
    const sido = g.dataset.sido;
    const key = gradeKeyOf(sido);
    const grade = GRADES[key];
    const v = valueOf(sido, state.metric);

    g.classList.toggle('is-selected', sido === state.selected);
    g.querySelector('.region-shape').style.fill = key === 'none' ? '' : grade.color;

    const valNode = g.querySelector('[data-role="value"]');
    if (valNode) valNode.textContent = fmtValue(v);

    const titleNode = g.querySelector('[data-role="title"]');
    if (titleNode) {
      titleNode.textContent = `${SIDO_FULL_NAME[sido]}, ${grade.label}, PM2.5 ${fmtValue(valueOf(sido, 'pm25'))}${UNIT}`;
    }
    g.setAttribute('aria-label', titleNode?.textContent ?? sido);
    g.setAttribute('aria-pressed', String(sido === state.selected));
  }
}

function showTooltip(sido, e) {
  const g = GRADES[gradeKeyOf(sido)];
  el.tooltip.innerHTML =
    `<b>${SIDO_FULL_NAME[sido]}</b> · ${g.label}<br>` +
    `PM10 <b>${fmtValue(valueOf(sido, 'pm10'))}</b> · PM2.5 <b>${fmtValue(valueOf(sido, 'pm25'))}</b> ${UNIT}`;
  el.tooltip.classList.add('is-visible');
  moveTooltip(e);
}
function moveTooltip(e) {
  el.tooltip.style.left = `${e.clientX}px`;
  el.tooltip.style.top = `${e.clientY - 8}px`;
}
function hideTooltip() {
  el.tooltip.classList.remove('is-visible');
}

function renderLegend() {
  el.legend.replaceChildren(
    ...['good', 'moderate', 'bad', 'verybad', 'none'].map((k) => {
      const g = GRADES[k];
      const s = document.createElement('span');
      s.className = 'legend-item';
      s.innerHTML = `<span class="legend-swatch" style="background:${g.color}"></span>${g.label}`;
      return s;
    }),
  );
}

/* --------------------------------------------------------------- 랭킹 */

function rankedRegions() {
  const withData = [];
  const without = [];
  for (const sido of SIDO_ORDER) {
    const v = valueOf(sido, state.metric);
    (v === null ? without : withData).push({ sido, value: v });
  }
  withData.sort((a, b) => (state.dir === 'asc' ? a.value - b.value : b.value - a.value));
  return { withData, without };
}

function renderRanking() {
  const { withData, without } = rankedRegions();
  const max = withData.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const isNarrow = window.matchMedia('(max-width: 767px)').matches;
  const limit = isNarrow && !state.expanded ? MOBILE_RANK_LIMIT : withData.length;

  el.rankList.replaceChildren(
    ...withData.slice(0, limit).map((row, i) => {
      const key = gradeOf(state.metric, row.value);
      const g = GRADES[key];
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rank-row' + (row.sido === state.selected ? ' is-selected' : '');
      btn.setAttribute('aria-current', row.sido === state.selected ? 'true' : 'false');
      btn.innerHTML =
        `<span class="rank-num">${i + 1}</span>` +
        `<span class="rank-name">${row.sido}</span>` +
        `<span class="rank-bar-track"><span class="rank-bar" style="width:${Math.max(4, (row.value / max) * 100)}%;background:${g.color}"></span></span>` +
        `<span class="rank-value"><span class="num">${fmtValue(row.value)}</span>` +
        `<span class="tag" style="background:${g.color};color:${g.onColor}">${g.label}</span></span>`;
      btn.setAttribute('aria-label',
        `${i + 1}위 ${SIDO_FULL_NAME[row.sido]} ${fmtValue(row.value)}${UNIT} ${g.label}`);
      btn.addEventListener('click', () => select(row.sido, { scrollChip: true }));
      li.appendChild(btn);
      return li;
    }),
  );

  if (without.length && limit >= withData.length) {
    const head = document.createElement('p');
    head.className = 'rank-empty-head';
    head.textContent = `정보 없음 · ${without.map((r) => r.sido).join(', ')}`;
    el.rankEmpty.replaceChildren(head);
  } else {
    el.rankEmpty.replaceChildren();
  }

  const hasMore = isNarrow && withData.length > MOBILE_RANK_LIMIT;
  el.moreBtn.hidden = !hasMore;
  el.moreBtn.textContent = state.expanded ? '접기' : `전체 보기 (${withData.length}개)`;
}

/* ------------------------------------------------------------ 헤더/상태 */

function renderStatus() {
  el.dataTime.textContent = fmtClock(state.payload?.dataTime);
  el.fetchedAt.textContent = fmtClock(state.payload?.fetchedAt);

  const root = el.app;
  root.classList.toggle('is-loading', state.loading && !state.payload);
  root.classList.toggle('is-error', Boolean(state.error));
  root.classList.toggle('is-stale', isStale());

  if (state.error) {
    el.alertMsg.textContent = state.payload
      ? `최신 데이터를 받아오지 못했어요 (${state.error}). 마지막으로 받은 값을 보여 드립니다.`
      : `데이터를 불러오지 못했어요 (${state.error}).`;
  }

  for (const b of el.metricSeg.children) {
    b.setAttribute('aria-pressed', String(b.dataset.metric === state.metric));
  }
  for (const b of el.dirSeg.children) {
    b.setAttribute('aria-pressed', String(b.dataset.dir === state.dir));
  }
  el.mapNote.textContent =
    state.metric === 'pm25' ? '숫자는 PM2.5 농도' : '숫자는 PM10 농도';
}

/* -------------------------------------------------------------- 렌더 */

function render() {
  renderStatus();
  renderChips();
  renderDetail();
  renderMap();
  renderRanking();
}

/* --------------------------------------------------------------- 초기화 */

function init() {
  Object.assign(el, {
    app: $('app'),
    chips: $('chips'),
    map: $('map'),
    legend: $('legend'),
    tooltip: $('tooltip'),
    rankList: $('rank-list'),
    rankEmpty: $('rank-empty'),
    moreBtn: $('more-btn'),
    metricSeg: $('metric-seg'),
    dirSeg: $('dir-seg'),
    detailRegion: $('detail-region'),
    detailGrade: $('detail-grade'),
    detailSub: $('detail-sub'),
    detailAdvice: $('detail-advice'),
    pm10Value: $('pm10-value'),
    pm10Grade: $('pm10-grade'),
    pm25Value: $('pm25-value'),
    pm25Grade: $('pm25-grade'),
    dataTime: $('data-time'),
    fetchedAt: $('fetched-at'),
    refresh: $('refresh-btn'),
    retry: $('retry-btn'),
    theme: $('theme-btn'),
    alertMsg: $('alert-msg'),
    mapNote: $('map-note'),
  });

  // 초기 선택 우선순위: URL 파라미터 > 마지막으로 본 지역 > 기본값(서울)
  try {
    const fromUrl = new URL(window.location.href).searchParams.get('sido');
    const last = localStorage.getItem('todayair:last');
    if (fromUrl && SIDO_ORDER.includes(fromUrl)) state.selected = fromUrl;
    else if (last && SIDO_ORDER.includes(last)) state.selected = last;
    const theme = localStorage.getItem('todayair:theme');
    if (theme) document.documentElement.dataset.theme = theme;
  } catch { /* 프라이빗 모드 등 — 기본값 유지 */ }

  buildChips();
  buildMap();
  renderLegend();

  el.refresh.addEventListener('click', () => load());
  el.retry.addEventListener('click', () => load());
  el.moreBtn.addEventListener('click', () => { state.expanded = !state.expanded; renderRanking(); });

  el.metricSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-metric]');
    if (!b) return;
    state.metric = b.dataset.metric;
    render();
  });
  el.dirSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]');
    if (!b) return;
    state.dir = b.dataset.dir;
    render();
  });

  el.theme.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('todayair:theme', next); } catch { /* 무시 */ }
  });

  window.addEventListener('resize', () => renderRanking());

  // 탭이 보이지 않을 때는 폴링하지 않는다.
  let timer = null;
  const startPolling = () => {
    stopPolling();
    timer = setInterval(() => load({ silent: true }), POLL_INTERVAL_MS);
  };
  const stopPolling = () => { if (timer) clearInterval(timer); timer = null; };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else { load({ silent: true }); startPolling(); }
  });

  render();
  load().then(startPolling);
}

init();
