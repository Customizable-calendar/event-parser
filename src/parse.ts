import {
  WEEKDAY_CODES,
  addDays,
  addMinutes,
  atMinutes,
  firstOccurrence,
  lastDayOfMonth,
  mondayOf,
  nextWeekday,
  startOfDay,
} from './dates';
import { ko } from './lexicon/ko';
import { Scanner, type Rule } from './scanner';
import type { Lexicon, ParseOptions, ParsedEvent, Recurrence, Weekday } from './types';

// ---------- 정규식 조각 ----------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 긴 단어 우선 대안 패턴. 단어 안의 공백은 "공백 있어도/없어도" 로 매칭 */
const alt = (words: string[]) =>
  [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => esc(w).replace(/ /g, '\\s*'))
    .join('|');
const key = (s: string) => s.replace(/\s+/g, '');
const lookup = <T>(map: Record<string, T>, word: string): T | undefined => {
  const k = key(word);
  for (const [w, v] of Object.entries(map)) if (key(w) === k) return v;
  return undefined;
};

/** 앞 글자가 한글/영문/숫자가 아님 (단어 시작) */
const S = '(?<![가-힣A-Za-z0-9])';
/** 날짜·시간 뒤에 붙는 조사 */
const TAIL = '(?:부터|까지|에는|에도|에|엔|날|쯤|경)?';
const WD = '[월화수목금토일]';
const SINO = '[이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구]';
const SINO_DIGITS: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };

function sino(s: string): number {
  if (!s.includes('십')) return SINO_DIGITS[s] ?? NaN;
  const [tens, ones] = s.split('십');
  return (tens ? SINO_DIGITS[tens] : 1) * 10 + (ones ? SINO_DIGITS[ones] : 0);
}

function compile(L: Lexicon) {
  const DP = alt(Object.keys(L.dayParts));
  const NAT = alt(Object.keys(L.nativeNumbers));
  const CNT = alt(Object.keys(L.dayCounts));
  const WEEK = alt(Object.keys(L.weekOffsets));
  const ORD = alt(Object.keys(L.ordinals));
  /** 단어 끝: 문장 끝, 한글/영문이 아닌 글자, 또는 바로 이어지는 하루 구간("오늘밤") */
  const END = `(?=$|[^가-힣A-Za-z]|${DP})`;
  const MIN = `(?:\\s*(?:(\\d{1,2})\\s*분|(반)|(${SINO})\\s*분))?`;
  const WD_TOKEN = `${WD}(?:요일)?(?=[월화수목금토일\\s,·/]|$|마다|에|엔)`;
  const WD_LIST = `((?:${WD_TOKEN}[\\s,·/]*)+)`;
  const ALARM = alt(L.alarmWords);
  const re = (src: string, flags = 'g') => new RegExp(src, flags);

  return {
    url: re('https?:\\/\\/\\S+', 'gi'),
    calendar: re('(?<!\\S)\\/([^\\s/]+)'),
    task: re(`^\\s*(?:${alt(L.taskPrefixes)})\\s*[:：]?(?=\\s|$)`, 'gi'),

    alarmOff: re(`${S}(?:${alt(L.alarmOffWords)})`),
    alarmUnit: re(`${S}(\\d+|${NAT})\\s*(분|시간|일)\\s*전(?:에)?\\s*(?:${ALARM})`),
    alarmCount: re(`${S}(${CNT})\\s*전(?:에)?\\s*(?:${ALARM})`),
    alarmLead: re(`${S}(?:${ALARM})\\s*(\\d+)\\s*(분|시간|일)\\s*전(?:에)?`),

    weekly: re(`${S}(?:매\\s*주|격\\s*주|매\\s*(\\d)\\s*주)(?:\\s*${WD_LIST})?\\s*(?:마다)?(?:에|엔)?`),
    weekdayEvery: re(`${S}(?:매\\s*(${WD})요일|((?:${WD}(?:요일)?)+)\\s*마다)`),
    weekdaysOnly: re(`${S}(?:평일\\s*마다|매\\s*평일|평일\\s*매일)`),
    weekendsOnly: re(`${S}(?:주말\\s*마다|매\\s*주말)`),
    daily: re(`${S}(?:매일|날마다)${END}`),
    monthly: re(
      `${S}(?:매\\s*달|매\\s*월(?!요일)|다달이)(?:\\s*(?:(\\d{1,2})\\s*일|(${ORD})\\s*(?:주\\s*)?(${WD})(?:요일)?|(말일|마지막\\s*날)))?(?:\\s*마다)?(?:에|엔)?`,
    ),
    yearly: re(`${S}(?:매\\s*년|매해|해마다)(?:\\s*(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일)?(?:에|엔)?`),
    count: re(`${S}(\\d+)\\s*(?:번|회)(?:\\s*반복)?(?![가-힣])`),

    relTime: re(`${S}(\\d+|${NAT})\\s*(분|시간)\\s*(?:후|뒤)(?:에)?`),
    allDay: re(`${S}(?:${alt(L.allDayWords)})`),

    ymd: re(`${S}(\\d{4})[-./]\\s*(\\d{1,2})[-./]\\s*(\\d{1,2})\\.?${TAIL}`),
    kmd: re(`${S}(?:(\\d{4})\\s*년\\s*)?(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${TAIL}${END}`),
    slash: re(`(?<![\\d/])(\\d{1,2})\\/(\\d{1,2})(?![\\d/])${TAIL}`),
    monthRel: re(`${S}(이번\\s*달|이달|다음\\s*달|담달|다다음\\s*달)\\s*(?:(\\d{1,2})\\s*일|(말일?)|(초))${TAIL}${END}`),
    monthEnd: re(`${S}월말${TAIL}${END}`),
    relDay: re(`${S}(${alt(Object.keys(L.relativeDays))})${TAIL}${END}`),
    afterUnit: re(`${S}(\\d+)\\s*(일|주|달|개월)\\s*(?:후|뒤)(?:에)?`),
    afterCount: re(`${S}(${CNT})\\s*(?:후|뒤)(?:에)?`),
    weekday: re(`${S}(?:(${WEEK})\\s*)?(${WD})(?:요일|욜)${TAIL}${END}`),
    weekdayShort: re(`${S}(${WEEK})\\s*(${WD})${TAIL}(?![가-힣])`),
    weekend: re(`${S}(?:(${WEEK})\\s*)?주말${TAIL}${END}`),
    week: re(`${S}(${WEEK})${TAIL}${END}`),
    holiday: re(`${S}(${alt(Object.keys(L.holidays))})${TAIL}${END}`),
    bareDay: re(`${S}(\\d{1,2})\\s*일(?=\\s*(?:부터|까지|에|엔)(?![가-힣]))${TAIL}`),
    bareDayAfterTilde: re(`(?<=[~\\-–]\\s*)(\\d{1,2})\\s*일${TAIL}`),

    timeRange: re(`(?:(${DP})\\s*)?(?<!\\d)(\\d{1,2})\\s*[-~]\\s*(\\d{1,2})\\s*시(?!간)${TAIL}`),
    timeDp: re(`(${DP})\\s*(?:(\\d{1,2})|(${NAT}))\\s*시(?!간)${MIN}${TAIL}`),
    timeNum: re(`(?<!\\d)(\\d{1,2})\\s*시(?!간)${MIN}${TAIL}`),
    timeNat: re(`${S}(${NAT})\\s*시(?!간)${MIN}${TAIL}`),
    clock: re(`(?:(${DP})\\s*)?(?<![\\d:])(\\d{1,2}):(\\d{2})(?![\\d:])${TAIL}`),
    noonMidnight: re(`${S}(정오|자정)${TAIL}`),

    durHour: re(
      `${S}(\\d+|${NAT})\\s*시간(?:\\s*(반)|\\s*(\\d{1,2})\\s*분)?(?:\\s*(?:동안|짜리|정도))?(?!\\s*(?:전|후|뒤))`,
    ),
    durMin: re(`${S}(\\d+)\\s*분(?:\\s*(?:동안|짜리|정도))?(?!\\s*(?:전|후|뒤))`),
    durDays: re(`${S}(?:(\\d+)\\s*일|(${CNT}))\\s*(?:동안|간)`),
    durNights: re(`${S}(\\d+)\\s*박\\s*(\\d+)\\s*일`),
    durHalfDay: re(`${S}반나절`),

    implicit: re(`${S}(${alt(Object.keys(L.implicitTimes))})(?:에|엔|때)?(?![가-힣])`),
    mention: re('@([^\\s@,]+)'),
    companion: re(
      `${S}((?:[가-힣A-Za-z]{2,10}\\s*,\\s*)*[가-힣A-Za-z]{2,10}?)(?:${alt(L.companionSuffixes)})(?![가-힣])`,
    ),
    location: re(`${S}([가-힣A-Za-z0-9]+?)에서(?![가-힣])`),
  };
}

const compiled = new WeakMap<Lexicon, ReturnType<typeof compile>>();

// ---------- 내부 타입 ----------

interface TimeHit {
  hour: number;
  minute: number;
  dp?: 'am' | 'pm';
}

interface DateHit {
  resolve: (prev?: Date) => Date | null;
  until: boolean;
}

interface DurationHit {
  minutes?: number;
  days?: number;
}

// ---------- 파서 ----------

export function parseEvent(input: string, options: ParseOptions = {}): ParsedEvent {
  const L = options.lexicon ?? ko;
  const now = options.now ?? new Date();
  const pmHours = options.pmHours ?? [1, 6];
  const rollToFuture = options.rollToFuture ?? true;
  const defaultDuration = options.defaultDurationMinutes ?? 60;
  const today = startOfDay(now);

  let R = compiled.get(L);
  if (!R) compiled.set(L, (R = compile(L)));

  const sc = new Scanner(input);
  const result: ParsedEvent = {
    type: 'event',
    title: '',
    allDay: false,
    attendees: [],
    alarms: [],
    alarmOff: false,
    spans: sc.spans,
  };

  const toNumber = (s: string): number => {
    const t = key(s);
    if (/^\d+$/.test(t)) return Number(t);
    return L.nativeNumbers[t] ?? L.dayCounts[t] ?? sino(t);
  };
  const weekdayIndex = (ch: string) => WEEKDAY_CODES.indexOf(L.weekdays[ch]);
  const weekdayList = (s: string): Weekday[] => [
    ...new Set([...s.replace(/요일/g, '').matchAll(/[월화수목금토일]/g)].map((x) => L.weekdays[x[0]])),
  ];
  const minuteOf = (digits?: string, half?: string, sinoWord?: string) =>
    digits ? Number(digits) : half ? 30 : sinoWord ? sino(sinoWord) : 0;
  const dayPart = (w?: string) => (w ? lookup(L.dayParts, w) : undefined);
  const unitMinutes = (u: string) => (u === '일' ? 1440 : u === '시간' ? 60 : 1);
  const isUntil = (m: RegExpMatchArray) => /까지\s*$/.test(m[0]);

  /** 연도 없는 날짜는 기준일(prev 또는 오늘)보다 이전이면 다음 해로 */
  const monthDay =
    (y: number | undefined, mo: number, d: number) =>
    (prev?: Date): Date | null => {
      const base = prev ?? today;
      const date = new Date(y ?? base.getFullYear(), mo - 1, d);
      if (date.getMonth() !== mo - 1) return null;
      if (y === undefined && rollToFuture && date < base) return new Date(date.getFullYear() + 1, mo - 1, d);
      return date;
    };
  const fixed = (date: Date | null) => () => date;
  const inWeek = (offset: number | undefined, weekday: number) =>
    offset === undefined ? nextWeekday(today, weekday) : addDays(mondayOf(today), offset * 7 + ((weekday + 6) % 7));

  // 1. URL, 캘린더(/회사), 할 일 접두어
  result.url = sc.first('url', [[R.url, (m) => m[0]]]);
  result.calendar = sc.first('calendar', [[R.calendar, (m) => m[1]]]);
  if (sc.first('task', [[R.task, () => true]])) result.type = 'task';

  // 2. 알림
  if (sc.first('alarm', [[R.alarmOff, () => true]])) result.alarmOff = true;
  result.alarms = sc.all('alarm', [
    [R.alarmUnit, (m) => toNumber(m[1]) * unitMinutes(m[2])],
    [R.alarmCount, (m) => toNumber(m[1]) * 1440],
    [R.alarmLead, (m) => Number(m[1]) * unitMinutes(m[2])],
  ]);

  // 3. 반복
  const recurrence = sc.first<Recurrence>('recurrence', [
    [
      R.weekly,
      (m) => ({
        freq: 'WEEKLY',
        interval: /격/.test(m[0]) ? 2 : m[1] ? Number(m[1]) : 1,
        byDay: m[2] ? weekdayList(m[2]) : undefined,
      }),
    ],
    [R.weekdayEvery, (m) => ({ freq: 'WEEKLY', interval: 1, byDay: weekdayList(m[1] ?? m[2]) })],
    [R.weekdaysOnly, () => ({ freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] })],
    [R.weekendsOnly, () => ({ freq: 'WEEKLY', interval: 1, byDay: ['SA', 'SU'] })],
    [R.daily, () => ({ freq: 'DAILY', interval: 1 })],
    [
      R.monthly,
      (m): Recurrence => {
        if (m[1]) return { freq: 'MONTHLY', interval: 1, byMonthDay: [Number(m[1])] };
        if (m[2]) return { freq: 'MONTHLY', interval: 1, byDay: [L.weekdays[m[3]]], bySetPos: lookup(L.ordinals, m[2]) };
        if (m[4]) return { freq: 'MONTHLY', interval: 1, byMonthDay: [-1] };
        return { freq: 'MONTHLY', interval: 1 };
      },
    ],
    [
      R.yearly,
      (m) =>
        m[1]
          ? { freq: 'YEARLY', interval: 1, byMonth: [Number(m[1])], byMonthDay: [Number(m[2])] }
          : { freq: 'YEARLY', interval: 1 },
    ],
  ]);
  if (recurrence) {
    const count = sc.first('recurrence', [[R.count, (m) => Number(m[1])]]);
    if (count) recurrence.count = count;
  }

  // 4. "30분 후", "하루 종일"
  const relStart = sc.first('time', [[R.relTime, (m) => addMinutes(now, toNumber(m[1]) * unitMinutes(m[2]))]]);
  const forcedAllDay = sc.first('allDay', [[R.allDay, () => true]]) ?? false;

  // 5. 날짜
  const dateHits = sc.all<DateHit>('date', [
    [R.ymd, (m) => ({ resolve: monthDay(Number(m[1]), Number(m[2]), Number(m[3])), until: isUntil(m) })],
    [
      R.kmd,
      (m) => ({ resolve: monthDay(m[1] ? Number(m[1]) : undefined, Number(m[2]), Number(m[3])), until: isUntil(m) }),
    ],
    [R.slash, (m) => ({ resolve: monthDay(undefined, Number(m[1]), Number(m[2])), until: isUntil(m) })],
    [
      R.monthRel,
      (m) => {
        const k = key(m[1]);
        const offset = k === '다음달' || k === '담달' ? 1 : k === '다다음달' ? 2 : 0;
        const y = today.getFullYear();
        const mo = today.getMonth() + offset;
        const date = m[2] ? new Date(y, mo, Number(m[2])) : m[3] ? lastDayOfMonth(y, mo) : new Date(y, mo, 1);
        return { resolve: fixed(date), until: isUntil(m) };
      },
    ],
    [R.monthEnd, (m) => ({ resolve: fixed(lastDayOfMonth(today.getFullYear(), today.getMonth())), until: isUntil(m) })],
    [R.relDay, (m) => ({ resolve: fixed(addDays(today, lookup(L.relativeDays, m[1])!)), until: isUntil(m) })],
    [
      R.afterUnit,
      (m) => {
        const n = Number(m[1]);
        const date =
          m[2] === '일'
            ? addDays(today, n)
            : m[2] === '주'
              ? addDays(today, n * 7)
              : new Date(today.getFullYear(), today.getMonth() + n, today.getDate());
        return { resolve: fixed(date), until: false };
      },
    ],
    [R.afterCount, (m) => ({ resolve: fixed(addDays(today, L.dayCounts[key(m[1])])), until: false })],
    [
      R.weekday,
      (m) => ({
        resolve: fixed(inWeek(m[1] ? lookup(L.weekOffsets, m[1]) : undefined, weekdayIndex(m[2]))),
        until: isUntil(m),
      }),
    ],
    [
      R.weekdayShort,
      (m) => ({ resolve: fixed(inWeek(lookup(L.weekOffsets, m[1]), weekdayIndex(m[2]))), until: isUntil(m) }),
    ],
    [
      R.weekend,
      (m) => ({ resolve: fixed(inWeek(m[1] ? lookup(L.weekOffsets, m[1]) : undefined, 6)), until: isUntil(m) }),
    ],
    [
      R.week,
      (m) => {
        const offset = lookup(L.weekOffsets, m[1])!;
        return { resolve: fixed(offset === 0 ? today : addDays(mondayOf(today), offset * 7)), until: isUntil(m) };
      },
    ],
    [
      R.holiday,
      (m) => {
        const [mo, d] = lookup(L.holidays, m[1])!;
        return { resolve: monthDay(undefined, mo, d), until: isUntil(m) };
      },
    ],
    ...[R.bareDay, R.bareDayAfterTilde].map(
      (re): Rule<DateHit> => [
        re,
        (m) => {
          const d = Number(m[1]);
          return {
            resolve: (prev) => {
              const base = prev ?? today;
              const date = new Date(base.getFullYear(), base.getMonth(), d);
              if (date.getDate() !== d) return null;
              return date < base ? new Date(base.getFullYear(), base.getMonth() + 1, d) : date;
            },
            until: isUntil(m),
          };
        },
      ],
    ),
  ]);

  const dates: { date: Date; until: boolean }[] = [];
  for (const hit of dateHits) {
    const date = hit.resolve(dates.at(-1)?.date);
    if (date) dates.push({ date, until: hit.until });
  }
  if (recurrence) {
    const i = dates.findIndex((d) => d.until);
    if (i >= 0) recurrence.until = dates.splice(i, 1)[0].date;
  }

  // 6. 시각
  const times = sc
    .all<TimeHit[]>('time', [
      [
        R.timeRange,
        (m) => [
          { hour: Number(m[2]), minute: 0, dp: dayPart(m[1]) },
          { hour: Number(m[3]), minute: 0 },
        ],
      ],
      [R.timeDp, (m) => [{ hour: toNumber(m[2] ?? m[3]), minute: minuteOf(m[4], m[5], m[6]), dp: dayPart(m[1]) }]],
      [R.timeNum, (m) => [{ hour: Number(m[1]), minute: minuteOf(m[2], m[3], m[4]) }]],
      [R.timeNat, (m) => [{ hour: toNumber(m[1]), minute: minuteOf(m[2], m[3], m[4]) }]],
      [R.clock, (m) => [{ hour: Number(m[2]), minute: Number(m[3]), dp: dayPart(m[1]) }]],
      [R.noonMidnight, (m) => [{ hour: m[1] === '정오' ? 12 : 0, minute: 0, dp: 'am' as const }]],
    ])
    .flat()
    .filter((t) => t.hour <= 24 && t.minute < 60);

  // 7. 기간
  const duration = sc.first<DurationHit>('duration', [
    [R.durHour, (m) => ({ minutes: toNumber(m[1]) * 60 + (m[2] ? 30 : m[3] ? Number(m[3]) : 0) })],
    [R.durMin, (m) => ({ minutes: Number(m[1]) })],
    [R.durDays, (m) => ({ days: m[1] ? Number(m[1]) : L.dayCounts[key(m[2])] })],
    [R.durNights, (m) => ({ days: Number(m[2]) })],
    [R.durHalfDay, () => ({ minutes: 240 })],
  ]);
  if (duration?.minutes) result.durationMinutes = duration.minutes;

  // 8. 시각이 없으면 "점심", "회식" 같은 단어로 기본 시각. 날짜 바로 뒤에 있을 때만 제목에서 뺀다
  let startMinutes = times[0] ? toMinutes(times[0], pmHours) : undefined;
  if (startMinutes === undefined && !relStart) {
    const [c] = sc.find([[R.implicit, (m) => lookup(L.implicitTimes, m[1])]]);
    if (c) {
      startMinutes = c.value;
      if (sc.followsField(c.start, ['date', 'recurrence'])) sc.take(c, 'time');
    }
  }

  // 9. 참석자, 장소
  result.attendees = [
    ...sc.all('attendee', [[R.mention, (m) => [m[1]]]]).flat(),
    ...sc.all('attendee', [[R.companion, (m) => m[1].split(/\s*,\s*/)]]).flat(),
  ];
  result.location = sc.first('location', [[R.location, (m) => m[1]]]);

  // 10. 시작/종료 계산
  const startDate = dates[0]?.date;
  const endDate = dates[1]?.date;
  let start: Date | undefined;
  if (relStart) start = relStart;
  else if (startDate) start = startMinutes !== undefined ? atMinutes(startDate, startMinutes) : startDate;
  else if (recurrence) {
    const day = firstOccurrence(recurrence, now, startMinutes);
    start = startMinutes !== undefined ? atMinutes(day, startMinutes) : day;
  } else if (startMinutes !== undefined) {
    start = atMinutes(today, startMinutes);
    if (rollToFuture && start < now) start = addDays(start, 1);
  }

  if (start) {
    result.start = start;
    result.allDay = forcedAllDay || (startMinutes === undefined && !relStart);
    if (result.allDay) {
      result.start = startOfDay(start);
      const last = endDate ?? (duration?.days ? addDays(result.start, duration.days - 1) : result.start);
      result.end = addDays(startOfDay(last), 1);
    } else if (times[1] && startMinutes !== undefined) {
      result.end = atMinutes(startOfDay(endDate ?? start), endMinutes(times[1], startMinutes));
    } else if (duration?.minutes) {
      result.end = addMinutes(start, duration.minutes);
    } else {
      result.end = addMinutes(start, defaultDuration);
    }
    if (result.type === 'task') result.end = undefined;
  }
  if (recurrence) result.recurrence = recurrence;

  // 11. 제목 = 나머지
  const filler = new Set(L.fillerWords);
  result.title = sc
    .remainder()
    .split(/\s+/)
    .filter((w) => w && !filler.has(w))
    .join(' ')
    .replace(/^[\s,.:~\-–]+|[\s,.:~\-–]+$/g, '');

  result.spans.sort((a, b) => a.start - b.start);
  return result;
}

function toMinutes(t: TimeHit, [pmFrom, pmTo]: [number, number]): number {
  let h = t.hour;
  if (t.dp === 'am') h = h === 12 ? 0 : h;
  else if (t.dp === 'pm') h = h < 12 ? h + 12 : h;
  else if (h >= pmFrom && h <= pmTo) h += 12;
  return h * 60 + t.minute;
}

/** 범위의 끝 시각: 오전/오후가 없으면 시작보다 뒤가 될 때까지 12시간씩 민다 ("오후 2시~4시", "11시~1시") */
function endMinutes(t: TimeHit, startMinutes: number): number {
  let m = t.dp ? toMinutes(t, [99, 99]) : (t.hour % 24) * 60 + t.minute;
  while (m <= startMinutes) m += 720;
  return m;
}
