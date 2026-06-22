// Function config (not the package.json JSON form) so the type-check task can
// run WITHOUT the staged filenames appended — `tsc` needs the whole project, not
// individual files. lint-staged stashes unstaged changes first, so type-check
// runs against the exact snapshot being committed.
export default {
  '*.{ts,tsx}': (files) => {
    const list = files.map((f) => `'${f}'`).join(' ');
    return [`prettier --write ${list}`, `eslint --fix ${list}`, 'pnpm type-check'];
  },
  '*.{json,md,css}': 'prettier --write',
};
