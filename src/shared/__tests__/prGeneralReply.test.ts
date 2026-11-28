import { describe, it, expect } from 'vitest';
import { generalReplyBody, quoteReply } from '../prGeneralReply';

describe('quoteReply', () => {
  it('quotes the first three lines, then mentions the author before the reply', () => {
    expect(quoteReply({ author: 'ada', body: 'One\ntwo\nthree' }, 'Agreed.')).toBe(
      '> One\n> two\n> three\n\n@ada Agreed.',
    );
  });

  it('marks a longer original as going on, leaving out blank and quoted lines', () => {
    const body = '> what bob said\n\nFirst\n\nSecond\nThird\nFourth';
    expect(quoteReply({ author: 'ada', body }, 'ok')).toBe(
      '> First\n> Second\n> Third\n> …\n\n@ada ok',
    );
  });

  it("doesn't repeat a mention the reply opens with, whatever its case", () => {
    expect(quoteReply({ author: 'Ada', body: 'Hi' }, '@ada thanks')).toBe('> Hi\n\n@ada thanks');
  });

  it('mentions no deleted account, and quotes nothing from an empty original', () => {
    expect(quoteReply({ author: 'ghost', body: 'Hi' }, 'ok')).toBe('> Hi\n\nok');
    expect(quoteReply({ author: 'ada', body: '  \n' }, ' ok ')).toBe('@ada ok');
  });
});

describe('generalReplyBody', () => {
  const to = { id: 'IC_1', author: 'ada', body: 'Hi' };

  it('quotes where the conversation has no threads (GitHub)', () => {
    expect(generalReplyBody('quote', to, 'ok')).toBe('> Hi\n\n@ada ok');
  });

  it('posts the text itself where general comments are threads (ADO)', () => {
    expect(generalReplyBody('thread', { ...to, id: '106:1' }, ' ok ')).toBe('ok');
  });
});
