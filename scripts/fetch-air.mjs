#!/usr/bin/env node
/**
 * 에어코리아 대기오염정보 API → data/air.json
 *
 * GitHub Actions 에서 매시간 실행된다. 브라우저는 이 결과 JSON 만 읽으므로
 * serviceKey 가 클라이언트로 나가지 않고 CORS 문제도 발생하지 않는다.
 *
 * 핵심: sidoName=전국 으로 **1회만** 호출한다. 이 API 는 시·도 평균이 아니라
 * 측정소 단위 원시 데이터를 주므로, 시·도별로 17번 호출하면 일 500회 한도를
 * 금방 소진한다. 전국 1회 → 애플리케이션에서 시·도별 평균 산출이 정답이다.
 *
 * 실행: SERVICE_KEY=... node scripts/fetch-air.mjs
 * 실패 시 프로세스가 0이 아닌 코드로 종료하며 기존 air.json 을 건드리지 않는다.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/air.json');

const ENDPOINT =
  'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty';

const SIDO_ORDER = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

const SERVICE_KEY = process.env.SERVICE_KEY;
if (!SERVICE_KEY) {
  console.error('[fetch-air] SERVICE_KEY 환경변수가 없습니다.');
  process.exit(1);
}

/**
 * 측정값 파싱. 아래 중 하나라도 걸리면 결측으로 본다.
 *  - 숫자로 파싱되지 않음 ('-', '', null)
 *  - flag 값이 있음 (점검및교정 / 자료이상 / 통신장애 …)
 * 결측을 0으로 떨어뜨리면 '좋음'으로 잘못 표시되므로 반드시 null 로 만든다.
 */
function readValue(raw, flag) {
  if (flag != null && String(flag).trim() !== '') return null;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '-') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function mode(values) {
  const count = new Map();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best = null;
  let bestN = -1;
  for (const [v, n] of count) {
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

async function fetchWithRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // 인증 실패·한도 초과 시 JSON 대신 XML 에러 문서가 돌아온다.
      if (text.trimStart().startsWith('<')) {
        throw new Error(`XML 오류 응답: ${text.slice(0, 200)}`);
      }
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      console.warn(`[fetch-air] 시도 ${i + 1}/${tries} 실패: ${err.message}`);
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

function buildUrl() {
  const qs = new URLSearchParams({
    serviceKey: SERVICE_KEY, // 디코딩된 키를 넣는다. URLSearchParams 가 인코딩한다.
    returnType: 'json',
    numOfRows: '1000',
    pageNo: '1',
    sidoName: '전국',
    ver: '1.3', // PM2.5(pm25Value) 및 항목별 등급 포함
  });
  return `${ENDPOINT}?${qs}`;
}

function aggregate(items) {
  const acc = new Map(SIDO_ORDER.map((s) => [s, { pm10: [], pm25: [], stations: 0 }]));
  const times = [];

  for (const it of items) {
    const sido = String(it.sidoName ?? '').trim();
    const bucket = acc.get(sido);
    if (!bucket) continue; // '전국' 등 예상 밖 값은 버린다

    bucket.stations += 1;
    if (it.dataTime) times.push(String(it.dataTime).trim());

    const pm10 = readValue(it.pm10Value, it.pm10Flag);
    const pm25 = readValue(it.pm25Value, it.pm25Flag);
    if (pm10 !== null) bucket.pm10.push(pm10);
    if (pm25 !== null) bucket.pm25.push(pm25);
  }

  const regions = {};
  for (const sido of SIDO_ORDER) {
    const b = acc.get(sido);
    const avg = (arr) =>
      arr.length === 0 ? null : Math.round((arr.reduce((a, c) => a + c, 0) / arr.length) * 10) / 10;
    regions[sido] = {
      pm10: avg(b.pm10),
      pm25: avg(b.pm25),
      stations: b.stations,
      pm10Stations: b.pm10.length,
      pm25Stations: b.pm25.length,
    };
  }

  return { regions, dataTime: times.length ? mode(times) : null };
}

async function main() {
  const json = await fetchWithRetry(buildUrl());

  const header = json?.response?.header;
  if (header && header.resultCode !== '00') {
    throw new Error(`API 오류 ${header.resultCode}: ${header.resultMsg}`);
  }

  const body = json?.response?.body;
  const items = Array.isArray(body?.items) ? body.items : body?.items?.item;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('측정소 데이터가 비어 있습니다.');
  }

  const { regions, dataTime } = aggregate(items);

  const withData = Object.values(regions).filter((r) => r.pm10 !== null || r.pm25 !== null).length;
  if (withData < 9) {
    // 17개 중 절반도 못 채웠다면 원본 장애로 보고 기존 파일을 지킨다.
    throw new Error(`유효 시·도가 ${withData}개뿐입니다. 기존 데이터를 유지합니다.`);
  }

  const payload = {
    dataTime,
    fetchedAt: new Date().toISOString(),
    stationCount: items.length,
    source: '한국환경공단 에어코리아 대기오염정보 (공공데이터포털)',
    regions,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[fetch-air] 저장 완료 · 기준 ${dataTime} · 측정소 ${items.length}개 · 유효 시·도 ${withData}/17`);
}

main().catch((err) => {
  console.error(`[fetch-air] 실패: ${err.message}`);
  process.exit(1);
});
