// Comparison anchors for billion-token milestone toasts.
// 1 token ≈ 0.75 English words. Word counts are public-domain estimates.
const COMPARISONS: ReadonlyArray<{ unit: string; wordsPer: number }> = [
  { unit: 'copies of War and Peace', wordsPer: 587_000 },
  { unit: 'King James Bibles', wordsPer: 783_000 },
  { unit: 'Lord of the Rings trilogies', wordsPer: 481_000 },
  { unit: 'complete Harry Potter series', wordsPer: 1_084_000 },
  { unit: 'complete works of Shakespeare', wordsPer: 884_000 },
  { unit: 'copies of Moby Dick', wordsPer: 209_000 },
  { unit: 'copies of Pride and Prejudice', wordsPer: 120_000 },
  { unit: "copies of Hitchhiker's Guide to the Galaxy", wordsPer: 46_000 },
];

const TOKENS_TO_WORDS = 0.75;

export interface BillionToastContent {
  title: string;
  description: string;
}

export function getBillionToastContent(billionN: number, totalTokens: number): BillionToastContent {
  const cmp = COMPARISONS[(billionN - 1) % COMPARISONS.length]!;
  const words = totalTokens * TOKENS_TO_WORDS;
  const count = Math.max(1, Math.round(words / cmp.wordsPer));
  return {
    title: `You just passed ${billionN.toLocaleString()} billion tokens.`,
    description: `About ${count.toLocaleString()} ${cmp.unit}.`,
  };
}
