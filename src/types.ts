export type Weekday = 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA';

export type Field =
  | 'task'
  | 'date'
  | 'time'
  | 'duration'
  | 'recurrence'
  | 'alarm'
  | 'allDay'
  | 'location'
  | 'attendee'
  | 'calendar'
  | 'url';

/** 입력 문자열에서 어느 구간이 어떤 필드로 인식됐는지 (하이라이트용) */
export interface Span {
  field: Field;
  start: number;
  end: number;
  text: string;
}

/** RFC 5545 RRULE에 대응하는 반복 규칙 */
export interface Recurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byDay?: Weekday[];
  /** byDay와 함께 쓰면 "N번째 요일" (-1 = 마지막) */
  bySetPos?: number;
  /** -1 = 말일 */
  byMonthDay?: number[];
  byMonth?: number[];
  count?: number;
  until?: Date;
}

export interface ParsedEvent {
  type: 'event' | 'task';
  /** 인식된 부분을 뺀 나머지. 비어 있을 수 있음 */
  title: string;
  start?: Date;
  /** 종일 일정: 마지막 날의 다음 날 0시(배타적). 시간 일정: 종료 시각. 할 일: 없음 */
  end?: Date;
  allDay: boolean;
  durationMinutes?: number;
  location?: string;
  attendees: string[];
  recurrence?: Recurrence;
  /** 시작 몇 분 전에 알릴지 */
  alarms: number[];
  alarmOff: boolean;
  calendar?: string;
  url?: string;
  spans: Span[];
}

export interface ParseOptions {
  /** 기준 시각 (기본: 현재) */
  now?: Date;
  /** 종료 시각이 없을 때 일정 길이 (기본 60분) */
  defaultDurationMinutes?: number;
  /** 오전/오후 없이 쓴 시각 중 오후로 볼 범위 (기본 [1, 6] → "3시" = 15시) */
  pmHours?: [number, number];
  /** 이미 지난 날짜/시각을 다음 해/다음 날로 넘길지 (기본 true) */
  rollToFuture?: boolean;
  /** 단어 사전 교체/확장 */
  lexicon?: Lexicon;
}

/**
 * 파서가 쓰는 단어 사전. 정규식 구조는 한국어 문법에 맞춰 코드에 있고,
 * 여기에는 바꿔 끼울 수 있는 단어 목록만 둔다.
 * 공백이 들어간 키는 입력에서 띄어쓰기 유무와 상관없이 매칭된다.
 */
export interface Lexicon {
  taskPrefixes: string[];
  relativeDays: Record<string, number>;
  weekOffsets: Record<string, number>;
  weekdays: Record<string, Weekday>;
  dayParts: Record<string, 'am' | 'pm'>;
  /** 단어 → 0시부터의 분 */
  implicitTimes: Record<string, number>;
  nativeNumbers: Record<string, number>;
  dayCounts: Record<string, number>;
  ordinals: Record<string, number>;
  allDayWords: string[];
  alarmWords: string[];
  alarmOffWords: string[];
  companionSuffixes: string[];
  /** 양력 고정 공휴일: [월, 일] */
  holidays: Record<string, [number, number]>;
  /** 제목에서 지울 남은 조사/기호 */
  fillerWords: string[];
}
