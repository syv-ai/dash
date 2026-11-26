/**
 * Strip user data from free text before it reaches PostHog (exception
 * messages and stacks). Paths become `<path>`, except frames inside Dash's
 * own bundle, which keep their module path after `app:/`; tokens and email
 * addresses become `<redacted>`. Pure.
 */
export function scrubText(text: string, opts: { home: string }): string {
  let out = text;
  // Dash's own code: keep the module path, drop where the app is installed.
  out = out.replace(/(?:file:\/\/)?[^\s'"()]*app\.asar(?:\.unpacked)?[\\/]/g, 'app:/');
  out = out.replace(/file:\/\/\/[^\s'"()]+/g, '<path>');
  if (opts.home) out = out.split(opts.home).join('~');
  out = out
    .replace(/(?<![\w:])~[\\/][^\s'"()]*/g, '<path>')
    .replace(/(?<![\w:/.])\/[^\s'"():/]+\/[^\s'"()]*/g, '<path>')
    .replace(/\b[A-Za-z]:\\[^\s'"()]*/g, '<path>')
    .replace(
      /\b(?:gh[pousr]_\w{20,}|github_pat_\w{20,}|sk-ant-[\w-]+|xox[abp]-[\w-]+)/g,
      '<redacted>',
    )
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<redacted>');
  return out;
}
