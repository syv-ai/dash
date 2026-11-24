import { useEffect, useState } from 'react';

/**
 * The time now (epoch ms), updated as each minute turns, for text that counts
 * down in minutes ("in 3h 12m"). Ticking on the minute, not every 60 s from
 * mount, keeps it in step with the clock it is read against.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        60_000 - (Date.now() % 60_000),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return now;
}
