import { useMemo } from 'react';
import { toSegments, type Segment } from './index';
import { parseEvent } from './parse';
import type { ParseOptions, ParsedEvent } from './types';

/** 입력이 바뀔 때마다 파싱 결과와 하이라이트 조각을 돌려준다 */
export function useEventParser(
  text: string,
  options: ParseOptions = {},
): { event: ParsedEvent; segments: Segment[] } {
  const { now, defaultDurationMinutes, pmHours, rollToFuture, lexicon } = options;
  return useMemo(() => {
    const event = parseEvent(text, { now, defaultDurationMinutes, pmHours, rollToFuture, lexicon });
    return { event, segments: toSegments(text, event.spans) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, now?.getTime(), defaultDurationMinutes, pmHours?.[0], pmHours?.[1], rollToFuture, lexicon]);
}
