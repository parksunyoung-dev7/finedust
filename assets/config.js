// 오늘의 공기 — 도메인 상수
// 등급 기준·색상·문구는 전부 이 파일에서만 정의한다.

/** 화면·API 공통 시·도 순서 (행정구역 순서 고정 — 값에 따라 재정렬하지 않는다) */
export const SIDO_ORDER = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

/** API 축약형 → 정식 명칭 (툴팁·aria-label 용) */
export const SIDO_FULL_NAME = {
  서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시',
  광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시',
  경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도',
  전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도',
  제주: '제주특별자치도',
};

/**
 * 등급 정의. level 이 클수록 나쁘다.
 * color 는 dataviz status 팔레트(good/warning/serious/critical) — 순서형 심각도 인코딩.
 * onColor 는 해당 배경 위에서 4.5:1 이상을 확보하는 글자색.
 */
export const GRADES = {
  none: {
    level: 0, label: '정보 없음', short: '—', icon: '?',
    color: '#898781', onColor: '#0b0b0b',
    advice: '이 지역의 측정값을 받아오지 못했어요.',
  },
  good: {
    level: 1, label: '좋음', short: '좋음', icon: '●',
    color: '#0ca30c', onColor: '#0b0b0b',
    advice: '공기가 깨끗해요. 야외 활동하기 좋은 날입니다.',
  },
  moderate: {
    level: 2, label: '보통', short: '보통', icon: '◆',
    color: '#fab219', onColor: '#0b0b0b',
    advice: '실외 활동에 큰 무리는 없어요. 민감하신 분은 무리한 운동만 피하세요.',
  },
  bad: {
    level: 3, label: '나쁨', short: '나쁨', icon: '▲',
    color: '#ec835a', onColor: '#0b0b0b',
    advice: '외출 시 마스크를 챙기세요. 장시간 실외 활동은 줄이는 게 좋아요.',
  },
  verybad: {
    level: 4, label: '매우나쁨', short: '매우나쁨', icon: '■',
    color: '#d03b3b', onColor: '#ffffff',
    advice: '가급적 실외 활동을 피하고, 창문을 닫아 두세요.',
  },
};

/** 등급 구간 (에어코리아 기준, 단위 ㎍/㎥). 상한 이하이면 해당 등급. */
const BREAKPOINTS = {
  pm10: [[30, 'good'], [80, 'moderate'], [150, 'bad']],
  pm25: [[15, 'good'], [35, 'moderate'], [75, 'bad']],
};

/** 농도 → 등급 키. null/NaN 이면 'none'. 결측을 0으로 취급하지 않는다. */
export function gradeOf(metric, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'none';
  for (const [max, key] of BREAKPOINTS[metric]) {
    if (value <= max) return key;
  }
  return 'verybad';
}

/** PM10·PM2.5 중 나쁜 쪽을 지역 대표 등급으로 삼는다. */
export function overallGradeOf(region) {
  const a = gradeOf('pm10', region.pm10);
  const b = gradeOf('pm25', region.pm25);
  if (a === 'none' && b === 'none') return 'none';
  if (a === 'none') return b;
  if (b === 'none') return a;
  return GRADES[a].level >= GRADES[b].level ? a : b;
}

export const METRIC_LABEL = { pm10: '미세먼지 PM10', pm25: '초미세먼지 PM2.5' };
export const UNIT = '㎍/㎥';

/** 데이터가 이 시간(ms)보다 오래되면 '오래된 데이터' 배지를 띄운다. 원본 갱신 주기는 1시간. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** 정적 JSON 재조회 주기(ms). GitHub Actions 가 매시 갱신하므로 10분이면 충분하다. */
export const POLL_INTERVAL_MS = 10 * 60 * 1000;

export const DATA_URL = './data/air.json';
