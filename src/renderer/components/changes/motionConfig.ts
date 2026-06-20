import type { Transition } from 'motion/react';

export const ROW_TRANSITION: Transition = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
};

export const rowEnterExit = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' as const },
  exit: { opacity: 0, height: 0 },
};
