import type { Field, Span } from './types';

export interface Candidate<T> {
  start: number;
  end: number;
  value: T;
}

export type Rule<T> = [RegExp, (m: RegExpMatchArray) => T | null | undefined];

/**
 * 입력 문자열 위에서 규칙을 차례로 적용하며, 이미 인식된 글자는 다시 쓰지 않는다.
 * 원문을 바꾸지 않으므로 span 위치가 항상 원문 기준이다.
 */
export class Scanner {
  readonly spans: Span[] = [];
  private readonly used: boolean[];

  constructor(readonly text: string) {
    this.used = new Array(text.length).fill(false);
  }

  /** 아직 안 쓴 구간에서 규칙에 맞는 후보들 (앞쪽·긴 것 우선, 서로 겹치지 않음) */
  find<T>(rules: Rule<T>[]): Candidate<T>[] {
    const found: Candidate<T>[] = [];
    for (const [re, build] of rules) {
      for (const m of this.text.matchAll(re)) {
        const raw = m[0];
        const start = m.index! + (raw.length - raw.trimStart().length);
        const end = m.index! + raw.trimEnd().length;
        if (end <= start || !this.isFree(start, end)) continue;
        const value = build(m);
        if (value !== null && value !== undefined) found.push({ start, end, value });
      }
    }
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const picked: Candidate<T>[] = [];
    for (const c of found) {
      if (picked.every((p) => c.start >= p.end || c.end <= p.start)) picked.push(c);
    }
    return picked;
  }

  take(c: Candidate<unknown>, field: Field) {
    for (let i = c.start; i < c.end; i++) this.used[i] = true;
    this.spans.push({ field, start: c.start, end: c.end, text: this.text.slice(c.start, c.end) });
  }

  first<T>(field: Field, rules: Rule<T>[]): T | undefined {
    const [c] = this.find(rules);
    if (!c) return undefined;
    this.take(c, field);
    return c.value;
  }

  all<T>(field: Field, rules: Rule<T>[]): T[] {
    return this.find(rules).map((c) => {
      this.take(c, field);
      return c.value;
    });
  }

  /** 시작 위치 바로 앞(공백만 사이에 둠)에 주어진 필드의 span이 있는가 */
  followsField(start: number, fields: Field[]): boolean {
    return this.spans.some((s) => fields.includes(s.field) && s.end <= start && this.text.slice(s.end, start).trim() === '');
  }

  /** 인식 안 된 나머지 (인식된 글자는 공백으로) */
  remainder(): string {
    return this.text
      .split('')
      .map((ch, i) => (this.used[i] ? ' ' : ch))
      .join('');
  }

  private isFree(start: number, end: number) {
    for (let i = start; i < end; i++) if (this.used[i]) return false;
    return true;
  }
}
