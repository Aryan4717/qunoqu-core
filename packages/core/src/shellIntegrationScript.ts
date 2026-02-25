/**
 * Shell integration script template for bash and zsh.
 * Source from ~/.bashrc or ~/.zshrc. Writes to ~/.qunoqu/shell-integration.sh via `qunoqu init`.
 * Sends command, exit code, cwd, and first 500 chars of output to /tmp/qunoqu.sock as JSON.
 */

export const SHELL_INTEGRATION_SCRIPT = `# qunoqu shell integration – bash and zsh
# Sends command history to qunoqu daemon. Requires Node.js and nc (or node used for send).

QUNOQU_SOCK="${"${QUNOQU_SOCK:-/tmp/qunoqu.sock}"}"
QUNOQU_PROJECT_ID="${"${QUNOQU_PROJECT_ID:-default}"}"

_qunoqu_send() {
  local cmd="$1" code="$2" cwd="$3" out="$4"
  if command -v node >/dev/null 2>&1; then
    node -e "
    const n=require('net');
    const s=new n.Socket();
    s.connect(process.env.QUNOQU_SOCK||'/tmp/qunoqu.sock',()=>{
      s.write(JSON.stringify({
        command: process.argv[1]||'',
        exitCode: parseInt(process.argv[2],10)||0,
        cwd: process.argv[3]||'',
        output: ((process.argv[4]||'').slice(0,500)),
        timestamp: Date.now(),
        projectId: process.env.QUNOQU_PROJECT_ID||'default'
      })+'\\\\n');
      s.end();
    });
    s.on('error',()=>{});
    " "$cmd" "$code" "$cwd" "$out" 2>/dev/null || true
  fi
}

if [ -n "$BASH_VERSION" ]; then
  _qunoqu_last_cmd=""
  trap '_qunoqu_last_cmd="$BASH_COMMAND"' DEBUG
  PROMPT_COMMAND="${"${PROMPT_COMMAND}"}${"${PROMPT_COMMAND:+;"}"}_qunoqu_send \\u0022$_qunoqu_last_cmd\\u0022 \\u0022$?\\u0022 \\u0022$PWD\\u0022 \\u0022\\u0022; "
elif [ -n "$ZSH_VERSION" ]; then
  _qunoqu_last_cmd=""
  preexec_functions+=(_qunoqu_preexec)
  precmd_functions+=(_qunoqu_precmd)
  _qunoqu_preexec() { _qunoqu_last_cmd="$1"; }
  _qunoqu_precmd() { _qunoqu_send "$_qunoqu_last_cmd" "$?" "$PWD" ""; _qunoqu_last_cmd=""; }
fi
`;