# ko-event-parser

한국어 자연어 일정 입력 파서. "내일 오후 3시 강남역에서 철수랑 미팅" → 제목/시작/종료/장소/참석자/반복/알림.
외부 의존성 없음, React 훅 포함. 설계 배경은 [docs/nlp-parser-design.md](docs/nlp-parser-design.md).

## 사용

```ts
import { parseEvent, toRRule } from 'ko-event-parser';

const e = parseEvent('매주 월수금 아침 7시 헬스');
e.title;                 // '헬스'
e.start;                 // 다음 월/수/금 07:00
toRRule(e.recurrence!);  // 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
```

React:

```tsx
import { useState } from 'react';
import { useEventParser } from 'ko-event-parser/react';

const COLORS = { date: '#2563eb', time: '#2563eb', location: '#16a34a', attendee: '#9333ea' } as const;

export function QuickAdd({ onAdd }: { onAdd: (e: ReturnType<typeof useEventParser>['event']) => void }) {
  const [text, setText] = useState('');
  const { event, segments } = useEventParser(text);
  return (
    <form onSubmit={(ev) => { ev.preventDefault(); onAdd(event); setText(''); }}>
      <input value={text} onChange={(ev) => setText(ev.target.value)} placeholder="내일 3시 회의" />
      <p>
        {segments.map((s, i) => (
          <span key={i} style={{ color: s.field ? COLORS[s.field as keyof typeof COLORS] ?? '#ea580c' : undefined }}>
            {s.text}
          </span>
        ))}
      </p>
    </form>
  );
}
```

## 결과 (`ParsedEvent`)

| 필드 | 설명 |
|---|---|
| `type` | `'event'` 또는 `'task'` ("할일", "투두", "리마인드"로 시작) |
| `title` | 인식된 부분을 뺀 나머지. 비어 있을 수 있음 |
| `start`, `end` | 종일이면 `end`는 마지막 날의 **다음 날 0시** (FullCalendar 방식). 할 일은 `end` 없음 |
| `allDay` | 시각이 없으면 true |
| `durationMinutes` | "2시간 동안" 등 |
| `location` | "○○에서" |
| `attendees` | "○○랑", "○○이랑 같이", "@○○" |
| `recurrence` | `toRRule()`로 RRULE 문자열 변환 |
| `alarms` | 시작 몇 분 전 (`"30분 전에 알려줘"` → `[30]`) |
| `calendar` | `/회사` |
| `spans` | 원문 위치별 인식 결과 → `toSegments()`로 하이라이트 |

## 옵션

```ts
parseEvent(text, {
  now: new Date(),              // 기준 시각
  defaultDurationMinutes: 60,
  pmHours: [1, 6],              // 오전/오후 없이 "3시" → 15시로 볼 범위
  rollToFuture: true,           // 지난 날짜/시각은 다음 해/다음 날로
  lexicon: { ...ko, holidays: { ...ko.holidays, 창립기념일: [4, 1] } },  // 단어 추가
});
```

## 개발

```
npm install
npm test        # vitest
npm run build   # dist/
```

빌드 결과는 확장자 없는 import를 쓰므로 Vite/webpack 등 번들러 환경용이다.

## 아직 안 되는 것

- 음력 공휴일 (설날, 추석)
- 한 단어가 아닌 장소 ("강남역 스타벅스에서" → "스타벅스"만)
- "1시간 30분 전 알림" 같은 복합 단위 알림
- 시간대 지정 ("뉴욕 시간 3시")
