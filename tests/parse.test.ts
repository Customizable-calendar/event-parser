import { describe, expect, it } from 'vitest';
import { parseEvent, toRRule, toSegments } from '../src/index';

// 2026-10-26 (월) 10:00
const now = new Date(2026, 9, 26, 10, 0);
const parse = (s: string) => parseEvent(s, { now });
const at = (mo: number, d: number, h = 0, mi = 0) => new Date(2026, mo - 1, d, h, mi);

describe('설계 문서 4.6 예시', () => {
  it('날짜 + 시각 + 장소 + 참석자', () => {
    const e = parse('내일 오후 3시 강남역에서 철수랑 미팅');
    expect(e.title).toBe('미팅');
    expect(e.start).toEqual(at(10, 27, 15));
    expect(e.end).toEqual(at(10, 27, 16));
    expect(e.location).toBe('강남역');
    expect(e.attendees).toEqual(['철수']);
    expect(e.allDay).toBe(false);
  });

  it('다음주 요일 + 암묵 시각(점심)', () => {
    const e = parse('다음주 화요일 점심 팀 회식');
    expect(e.title).toBe('팀 회식');
    expect(e.start).toEqual(at(11, 3, 12));
  });

  it('매주 여러 요일 반복', () => {
    const e = parse('매주 월수금 아침 7시 헬스');
    expect(e.title).toBe('헬스');
    expect(toRRule(e.recurrence!)).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(e.start).toEqual(at(10, 28, 7)); // 오늘(월) 7시는 지났으므로 수요일
  });

  it('날짜 범위 → 종일 일정', () => {
    const e = parse('12월 24일부터 26일까지 제주 여행');
    expect(e.title).toBe('제주 여행');
    expect(e.allDay).toBe(true);
    expect(e.start).toEqual(at(12, 24));
    expect(e.end).toEqual(at(12, 27));
  });

  it('할 일 + 마감', () => {
    const e = parse('할일 보고서 제출 금요일까지');
    expect(e.type).toBe('task');
    expect(e.title).toBe('보고서 제출');
    expect(e.start).toEqual(at(10, 30));
    expect(e.end).toBeUndefined();
  });

  it('알림', () => {
    const e = parse('내일 10시 기획회의 30분 전에 알려줘');
    expect(e.title).toBe('기획회의');
    expect(e.start).toEqual(at(10, 27, 10));
    expect(e.alarms).toEqual([30]);
  });

  it('기간', () => {
    const e = parse('모레 2시간 동안 코딩');
    expect(e.title).toBe('코딩');
    expect(e.start).toEqual(at(10, 28));
    expect(e.durationMinutes).toBe(120);
  });

  it('매달 N번째 요일', () => {
    const e = parse('매달 첫째 월요일 월간 보고');
    expect(e.title).toBe('월간 보고');
    expect(toRRule(e.recurrence!)).toBe('FREQ=MONTHLY;BYDAY=1MO');
    expect(e.start).toEqual(at(11, 2));
  });
});

describe('시각 해석', () => {
  it('오전/오후 없는 1~6시는 오후', () => {
    expect(parse('3시 회의').start).toEqual(at(10, 26, 15));
  });

  it('지난 시각은 내일로', () => {
    expect(parse('9시 조깅').start).toEqual(at(10, 27, 9));
  });

  it('시각 범위', () => {
    const e = parse('오후 2시~4시 세미나');
    expect(e.title).toBe('세미나');
    expect(e.start).toEqual(at(10, 26, 14));
    expect(e.end).toEqual(at(10, 26, 16));
  });

  it('고유어 숫자 + 반', () => {
    const e = parse('세 시 반 커피');
    expect(e.title).toBe('커피');
    expect(e.start).toEqual(at(10, 26, 15, 30));
  });

  it('붙여 쓴 입력', () => {
    const e = parse('내일3시강남역');
    expect(e.start).toEqual(at(10, 27, 15));
    expect(e.title).toBe('강남역');
  });

  it('"세시간"은 시각이 아니라 기간', () => {
    const e = parse('내일 세시간 대청소');
    expect(e.durationMinutes).toBe(180);
    expect(e.title).toBe('대청소');
  });

  it('N시간 후', () => {
    expect(parse('2시간 후 회의').start).toEqual(at(10, 26, 12));
  });
});

describe('기타 필드', () => {
  it('공휴일 + 저녁 시각', () => {
    const e = parse('크리스마스 파티 저녁 7시');
    expect(e.start).toEqual(at(12, 25, 19));
    expect(e.title).toBe('파티');
  });

  it('격주 + 캘린더 지정', () => {
    const e = parse('격주 화요일 스터디 /회사');
    expect(toRRule(e.recurrence!)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU');
    expect(e.calendar).toBe('회사');
    expect(e.title).toBe('스터디');
    expect(e.start).toEqual(at(10, 27));
  });

  it('URL', () => {
    const e = parse('회의 https://meet.example.com/abc 내일 2시');
    expect(e.url).toBe('https://meet.example.com/abc');
    expect(e.title).toBe('회의');
    expect(e.start).toEqual(at(10, 27, 14));
  });

  it('@멘션 참석자, 제목 없음', () => {
    const e = parse('@민지 @준호 내일 점심');
    expect(e.attendees).toEqual(['민지', '준호']);
    expect(e.start).toEqual(at(10, 27, 12));
    expect(e.title).toBe('');
  });

  it('매일 + 반복 횟수', () => {
    const e = parse('매일 밤 11시 일기 쓰기 10번');
    expect(toRRule(e.recurrence!)).toBe('FREQ=DAILY;COUNT=10');
    expect(e.start).toEqual(at(10, 26, 23));
    expect(e.title).toBe('일기 쓰기');
  });

  it('반복 종료일', () => {
    const e = parse('매주 목요일 요가 12월 31일까지');
    expect(toRRule(e.recurrence!)).toBe('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231');
    expect(e.start).toEqual(at(10, 29));
  });

  it('여러 참석자', () => {
    expect(parse('철수, 영희랑 저녁 약속 금요일').attendees).toEqual(['철수', '영희']);
  });
});

describe('하이라이트', () => {
  it('원문을 구간으로 나눈다', () => {
    const text = '내일 오후 3시 강남역에서 미팅';
    const segs = toSegments(text, parse(text).spans);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.filter((s) => s.field).map((s) => [s.field, s.text])).toEqual([
      ['date', '내일'],
      ['time', '오후 3시'],
      ['location', '강남역에서'],
    ]);
  });
});
