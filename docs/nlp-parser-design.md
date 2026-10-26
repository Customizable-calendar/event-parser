# 자연어 일정 입력 파서 설계 문서

> 참고 대상: Fantastical for Windows 4.2.0 (`FlexibitsInc.Fantastical_4.2.0.0_x64`)
> 분석일: 2026-10-26 · 방법: 설치 패키지의 리소스 파일 열람, ONNX 모델 시그니처 확인, 엔진 DLL 문자열 검색 (정적 분석만, 앱 실행 관찰 없음)
>
> 이 문서는 **구조와 동작을 이해하기 위한 참고 자료**다. Fantastical의 코드, 모델(`.onnx`), 키워드/정규식 테이블을 내 프로그램에 복사하거나 로드하지 않는다. 아래 설계안(4장 이후)은 독자적으로 다시 만든다.

---

## 1. 한 줄 요약

Fantastical의 자연어 입력은 **"규칙 기반 날짜/시간 파서 + 토큰 단위 ML 태거(BiLSTM-CRF) + 선택적 온디바이스 LLM"** 의 3단 구조다. 언어별 차이는 코드가 아니라 **언어 데이터 파일(키워드·정규식 표)** 로 분리되어 있다. 한국어는 지원하지 않는다 (en, de, fr, es, it, pt, ja만 존재).

---

## 2. 관찰한 것 (근거)

| # | 관찰 | 근거 파일 |
|---|---|---|
| O1 | 파서 진입점이 3개: `parseBypassSentence`, `parseNLPSentence`, `parseSentenceWithFoundationModel:language:useSplitLanguageResponse:` | `libFantastical.dll` 문자열 |
| O2 | 언어별 모델 `Parsenet{En,De,Fr,Es,It,Pt,Ja}.onnx` (각 250~375KB, 동적 양자화) | `resources/ParsenetModels/` |
| O3 | 모델 입력 `features[seq_len, 369]`(float) + `variant[1]`(int64), 출력 `emissions`, `transitions[1936]`(=44×44), `initial_probabilities[44]` | ONNX 그래프 |
| O4 | 모델 내부: 양방향 LSTM(hidden 96) → Linear(192→42) → variant 마스크(4×42). Viterbi 디코딩은 모델 밖(네이티브 엔진)에서 수행 (`Viterbi lattice:` 로그 문자열) | ONNX 그래프, DLL 문자열 |
| O5 | 엔진이 .NET의 onnxruntime을 브리지로 호출 (`ParsenetModelBridge runPrediction:usingVariant:features:...`) | DLL 문자열 |
| O6 | 언어 데이터 plist 구조: `strings`(개념→표면형), `regex`(월/요일/시간 등), `prenormalize`(정규화 치환 규칙), `numbers`(서수/숫자 단어→숫자), `implicit times`(점심=12:00 등), `durations`, `repeaters`(반복 요일/월/하루 구간), `holidays`, `multiword holidays`, `and`(구분자) | `resources/LanguageData/*.plist` |
| O7 | 할 일(Task) 판별용 접두어 목록 (`todo`, `remind me to` …, 다국어 혼합) | `resources/TaskPrefixes.plist` |
| O8 | 도시명→시간대 사전, 시간대 약어표 | `FBTimeZoneCity.plist`, `NSTimeZones/*.plist` |
| O9 | 결과 객체 `FBParserItem` 필드: `type, title, location, with, attendees, startDate, endDate, startTimeZone, endTimeZone, dates, isAllDay, floating, notes, URL, recurrenceRule, calendar, alarms, alarmOff, availabilityString, priority, language, rawLabels, rawLabelRanges, sourceEngine` | DLL ObjC 타입 정보 |
| O10 | 내부 C++ 구조: `CalendarEvent { map<CalendarLabel, vector<(문자열, LabelRange)>>, … }`, `datetimeparser::RecurrenceRule`, 토큰 종류 `text / quoted / separator` | DLL 타입 인코딩 |
| O11 | LLM 경로는 Windows AI의 Phi Silica 워크로드를 사용 (`PSOnnxRuntime`, `PSTokenizerShared` 패키지 선언) | `workloads*.json` |
| O12 | 입력창은 인식된 토큰을 하이라이트하는 전용 컨트롤 | `Components/General/TokenizableRichEditBox.xbf` |

### 추론 (확인 안 됨)
- I1. 42개 출력 = 약 20개 라벨(제목/장소/참석자/날짜/시간/알림/캘린더/메모/URL …)의 BIO 태그 + O. 정확한 라벨 이름은 확인 못 함.
- I2. 4개 variant = 입력 모드(일정/할 일/… )에 따라 허용 라벨을 마스킹.
- I3. 369개 입력 특징 = 단어 임베딩이 아니라 **손으로 설계한 특징**(토큰이 월 이름 정규식에 매치되는가, 숫자인가, 대문자인가, 앞 토큰이 "at"인가 등). 언어 데이터 plist의 각 항목이 특징으로 쓰였을 가능성이 높음. `keep_features[245]`로 실제 사용 특징은 245개.
- I4. 흐름: 정규화 → 토큰화 → 특징 추출 → Parsenet 태깅 → 라벨 구간별로 규칙 파서가 의미 해석(날짜/반복/알림) → `FBParserItem`. Bypass는 ML 없이 규칙만 쓰는 경로로 추정.

### 모름
- 라벨 이름 전체 목록, 특징 정의, 경로 선택 기준(언제 LLM을 쓰는가), 학습 데이터.

---

## 3. 배울 점 (설계 원칙)

1. **언어 데이터와 엔진 분리** — 엔진은 "개념"(`tomorrow`, `every`, `until`)만 알고, 각 언어 파일이 그 개념의 표면형을 제공한다. 새 언어 = 데이터 파일 하나 추가.
2. **정규화 먼저** — "tomorrow" → "next day", "noon" → "12:00pm", "ago/before" → "past"처럼 표현을 표준형으로 바꾼 뒤 파싱하면 문법 규칙 수가 크게 줄어든다.
3. **구간 태깅과 의미 해석 분리** — ML은 "이 단어들이 장소다"까지만, 실제 날짜 계산은 결정적인 규칙 코드가 한다. ML이 틀려도 날짜 계산은 예측 가능하다.
4. **작은 모델** — 300KB짜리 BiLSTM-CRF로 충분. 실시간 타이핑 중에도 돌아간다.
5. **LLM은 선택적 상위 경로** — 기기가 지원할 때만 사용, 기본은 로컬 규칙+소형 모델.
6. **원문 구간 보존** — `rawLabelRanges`로 어느 글자가 어떤 필드가 됐는지 기억 → 입력창에서 하이라이트 가능.
7. **암묵적 정보** — "점심" → 12:00, "저녁" → 18:00 같은 기본 시각 표.

---

## 4. 내 프로그램 설계안 (한국어 우선)

### 4.1 파이프라인

```
입력 문자열
  │
  ├─ 1) 모드 판별: 할 일 접두어("할일", "리마인드", "잊지말고", "[]") → type=task
  ├─ 2) 정규화: 전각→반각, 공백 정리, "내일"→상대일+1, "정오"→12:00, 한글 숫자→아라비아 숫자
  ├─ 3) 토큰화: 어절 단위 + 조사 분리("강남역에서" → "강남역" + "에서")
  ├─ 4) 구간 추출 (둘 중 택1, 처음엔 A)
  │     A. 규칙: 날짜/시간/반복/알림 정규식 → 남은 부분에서 장소·참석자 패턴
  │     B. 태거: BIO 태깅 모델 (2단계에서 도입)
  ├─ 5) 의미 해석: 날짜 구간 → 실제 datetime, 반복 구간 → RRULE, 알림 → 오프셋
  ├─ 6) 남은 텍스트 = 제목 (조사/불용어 정리)
  └─ 7) 결과 객체 + 원문 구간 정보 반환
  (옵션) 8) 규칙 결과의 신뢰도가 낮으면 LLM 경로로 재시도
```

### 4.2 결과 데이터 모델

```ts
type ParsedItem = {
  type: "event" | "task";
  title: string;
  location?: string;
  attendees?: string[];         // "철수랑", "@민지"
  start?: DateTime;             // 시간대 포함
  end?: DateTime;
  allDay: boolean;
  floating: boolean;            // 시간대 고정 안 함
  recurrence?: RRule;           // RFC 5545
  alarms?: Duration[];          // 시작 기준 음수 오프셋
  calendar?: string;            // "/회사" 같은 지정
  url?: string;
  notes?: string;
  spans: { field: string; start: number; end: number }[];  // 하이라이트용
  engine: "rule" | "tagger" | "llm";
  confidence: number;
};
```

### 4.3 한국어 언어 데이터 (직접 작성)

Fantastical 파일 구조(O6)를 본뜬 **스키마**만 쓰고 내용은 새로 만든다.

| 섹션 | 한국어 예시 |
|---|---|
| 상대 날짜 | 오늘(0), 내일(+1), 모레(+2), 글피(+3), 어제(-1), 그제/그저께(-2) |
| 상대 주/월 | 이번 주, 다음 주, 다다음 주, 지난주, 이번 달, 다음 달 |
| 요일 | 월(요일)?, 화, 수, 목, 금, 토, 일 / 주말, 평일 |
| 시간 | `(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})시(\s*(\d{1,2})분|\s*반)?`, `\d{1,2}:\d{2}` |
| 하루 구간 기본값 | 아침 → 오전, 저녁/밤 → 오후, 새벽 → 오전 (시만 있을 때 1~6시는 오후로 가정 등 휴리스틱) |
| 암묵 시각 | 아침식사 08:00, 점심 12:00, 저녁식사 18:00, 회식 19:00 |
| 기간 | `(\d+)\s*(분|시간|일|주|개월|달|년)\s*(동안)?`, 반나절, 하루종일 |
| 범위 | ~, 부터 … 까지, 에서 … 까지 |
| 반복 | 매일, 매주, 격주, 매달/매월, 매년, 매주 화목, 평일마다, 매달 첫째 월요일 |
| 반복 종료 | …까지, N번 |
| 알림 | `(\d+)(분|시간|일) 전(에)? (알림|알려줘)`, 알림 없이 |
| 장소 조사 | 에서, 에 (장소 명사 뒤) — "에"는 시간 뒤에도 붙으므로 시간 구간 먼저 제거 |
| 참석자 | `(\S+)(랑|이랑|와|과|하고)\s`, `@이름` |
| 할 일 접두어 | 할일, 할 일, 투두, 리마인드, 잊지말고, 기억해 |
| 공휴일 | 설날, 추석 (음력 → 양력 변환 표 필요), 크리스마스, 어린이날 … |
| 한글 숫자 | 한/두/세/네/다섯…열두 (시 앞), 일/이/삼… (분 앞), 첫째/둘째/셋째 |

### 4.4 한국어 특이점 (영어 기반 Fantastical에 없는 문제)

1. **조사 결합** — "강남역에서", "3시에", "철수랑". 어절 끝 조사 분리가 필수. 형태소 분석기 없이도 조사 목록 + 최장 일치로 시작 가능.
2. **어순 자유** — "내일 3시 회의" = "회의 내일 3시". 위치 기반 규칙 대신 패턴 우선 추출 후 나머지를 제목으로.
3. **오전/오후 생략** — "3시 회의"는 대부분 오후. 업무 시간대(8~20시)로 보정하는 기본 규칙 필요.
4. **고유어 숫자 vs 한자어 숫자** — "세 시 삼십 분".
5. **음력 공휴일** — 설날/추석은 연도별 변환 표.
6. **띄어쓰기 오류** — "내일3시강남역" 처럼 붙여 써도 동작해야 함 → 정규화 단계에서 숫자/단위 경계에 공백 삽입.

### 4.5 단계별 구현 계획

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 1 | 언어 데이터 스키마 + 한국어 데이터 파일, 정규화기, 날짜/시간/기간 규칙 파서 | 테스트 문장 100개 중 날짜·시간 90% 정확 |
| 2 | 반복(RRULE), 알림, 참석자, 장소, 할 일 판별 | 4.6 테스트셋 통과 |
| 3 | 입력창 실시간 하이라이트(spans 활용) | 타이핑 중 50ms 이내 갱신 |
| 4 | (선택) BIO 태거: 규칙 파서로 자동 라벨링한 데이터 + 수작업 보정으로 소형 BiLSTM-CRF 또는 CRF 학습 → 장소/제목 경계 정확도 개선 | 규칙 대비 장소 F1 향상 |
| 5 | (선택) LLM 폴백: 규칙 신뢰도 낮을 때만 JSON 스키마 출력 요청 | 실패 케이스 회복률 측정 |

### 4.6 테스트 문장 예시 (기대 결과)

| 입력 | 기대 |
|---|---|
| 내일 오후 3시 강남역에서 철수랑 미팅 | 제목=미팅, 장소=강남역, 참석자=[철수], 시작=내일 15:00 |
| 다음주 화요일 점심 팀 회식 | 제목=팀 회식, 시작=다음주 화 12:00 |
| 매주 월수금 아침 7시 헬스 | 반복=WEEKLY;BYDAY=MO,WE,FR, 시작 07:00 |
| 12월 24일부터 26일까지 제주 여행 | 종일, 12/24~12/26, 제목=제주 여행 (장소 추정은 옵션) |
| 할일 보고서 제출 금요일까지 | type=task, 마감=이번주 금 |
| 내일 10시 기획회의 30분 전에 알려줘 | 알림=-30분, 시작=내일 10:00, 제목=기획회의 |
| 모레 2시간 동안 코딩 | 시작=모레(종일), durationMinutes=120 |
| 매달 첫째 월요일 월간 보고 | RRULE=MONTHLY;BYDAY=1MO |

---

## 5. 법적 경계

- 사용 OK: 이 문서의 구조·원칙·스키마 아이디어, 공개 표준(RFC 5545 RRULE, ICU, IANA 시간대).
- 사용 금지: Fantastical의 `.onnx` 모델, `LanguageData` 정규식/키워드 표, `TaskPrefixes`, DLL 코드의 복사·로드·번역.
- 한국어 데이터와 테스트셋은 처음부터 직접 작성한다.

---

## 6. 다음에 확인할 것 (선택)

- REA MCP 연결 후 `Fantastical.dll`(.NET) 분석: 입력창 하이라이트 방식, 엔진 호출 순서 → 4.5의 3단계 참고용.
- 앱을 실제로 써 보며 엣지 케이스 관찰(블랙박스 테스트): 같은 문장을 넣고 결과를 기록하는 방식은 코드 분석 없이 동작을 비교할 수 있어 가장 안전하다.
