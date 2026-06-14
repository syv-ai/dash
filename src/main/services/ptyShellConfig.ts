import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ---------------------------------------------------------------------------
// Custom zsh prompt via ZDOTDIR
//
// Dash spawns interactive shells with ZDOTDIR pointed at a generated config dir
// so it can apply a badge-style prompt on top of the user's own zsh config. The
// rc files below chain back to the user's $HOME dotfiles, then restore ZDOTDIR
// and layer the Dash prompt last.
// ---------------------------------------------------------------------------

const SHELL_ZSHENV = `\
# Save our ZDOTDIR so .zshrc can find prompt.zsh
export __DASH_ZDOTDIR="\${ZDOTDIR}"
# Source user's .zshenv from HOME
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
# Keep ZDOTDIR as our dir so zsh loads .zshrc etc. from here
ZDOTDIR="\${__DASH_ZDOTDIR}"
`;

const SHELL_ZPROFILE = `\
[[ -f "$HOME/.zprofile" ]] && source "$HOME/.zprofile"
`;

const SHELL_ZSHRC = `\
# Restore ZDOTDIR to HOME so user config loads normally
ZDOTDIR="$HOME"
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
# Apply our prompt after user config
source "\${__DASH_ZDOTDIR}/prompt.zsh"
`;

const SHELL_ZLOGIN = `\
[[ -f "$HOME/.zlogin" ]] && source "$HOME/.zlogin"
`;

const SHELL_PROMPT = `\
# Dash badge-style prompt — uses ANSI 16 colors (themed by xterm.js)
autoload -Uz add-zsh-hook

# Prevent venv from prepending (name) to prompt
export VIRTUAL_ENV_DISABLE_PROMPT=1

__dash_prompt_precmd() {
  # Clack-style two-line prompt, matching the ports side-car TUI:
  #   ◇  dash  .venv     <- green ◇ on success, red ■ on failure; %1~ dir only
  #   │  <input>         <- gray gutter bar
  local sym="%(?.%F{2}◇.%F{1}■)%f"
  local dir="%F{12}%1~%f"

  local venv=""
  if [[ -n "\${VIRTUAL_ENV}" ]]; then
    venv="  %F{6}\${VIRTUAL_ENV:t}%f"
  fi

  PROMPT="\${sym}  \${dir}\${venv}
%F{8}│%f  "
  RPROMPT=""
}

add-zsh-hook precmd __dash_prompt_precmd
# Set PROMPT immediately so the first prompt is styled — precmd may not
# fire before the initial prompt in all zsh configurations.
__dash_prompt_precmd
`;

let shellConfigDir: string | null = null;

/**
 * Materialize the Dash zsh config dir (under userData/shell) and return its
 * path, for use as ZDOTDIR when spawning an interactive shell. Files are only
 * rewritten when their content changed; the resolved dir is cached per process.
 */
export function ensureShellConfig(): string {
  if (shellConfigDir) return shellConfigDir;

  const dir = path.join(app.getPath('userData'), 'shell');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const files: Record<string, string> = {
    '.zshenv': SHELL_ZSHENV,
    '.zprofile': SHELL_ZPROFILE,
    '.zshrc': SHELL_ZSHRC,
    '.zlogin': SHELL_ZLOGIN,
    'prompt.zsh': SHELL_PROMPT,
  };

  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
    if (existing !== content) {
      fs.writeFileSync(filePath, content);
    }
  }

  shellConfigDir = dir;
  return dir;
}
