#!/usr/bin/env node
/**
 * Hook PreToolUse del monitor SoftRestaurant.
 *
 * Portado del hook de Fiscalito (Python) a Node porque este stack no usa Python:
 * /api y /web corren sobre Node 22 y /agent sobre .NET 8. Pedirle Python a quien
 * clone el repo sólo para que el hook corra era una dependencia inventada.
 *
 * QUÉ HACE
 *   Auto-aprueba comandos SEGUROS (sólo lectura + verificación: lint, typecheck,
 *   test, dotnet build) para que el agente no pregunte por ellos, incluso
 *   dirigiendo el trabajo desde el celular. Cualquier cosa que NO sea claramente
 *   segura cae al flujo normal (pregunta). Es "fail-safe": ante la duda, NO aprueba.
 *
 * QUÉ NO AUTO-APRUEBA (a propósito)
 *   - node -e "..." / -p "..." (código arbitrario)
 *   - escrituras (>, rm, mv, Set-Content...), git push, sudo, ssh, secretos
 *   - docker compose down/up (levantan y tiran servicios de verdad)
 *   - prisma migrate / db push (escriben en la base)
 *   - npm install / npm ci (escriben node_modules; los cubre el allow del
 *     settings.json, que sí muestra su regla — este hook sólo rescata lo
 *     compuesto y lo obvio)
 *   - PowerShell con control de flujo (if/else, { }).
 *   NO puede sobreescribir las reglas 'deny'/'ask' del settings.json.
 *
 * CONTRATO DEL HOOK
 *   Entra el JSON del tool call por stdin; sale por stdout un JSON con la
 *   decisión, o nada. Exit 0 SIEMPRE: un hook que truena no debe bloquear al
 *   agente, sólo dejar de auto-aprobar.
 */

// Binarios / cmdlets de SÓLO LECTURA.
const SAFE = new Set([
  'ls', 'cat', 'find', 'grep', 'rg', 'head', 'tail', 'wc', 'sort', 'uniq',
  'pwd', 'which', 'where', 'tree', 'file', 'diff', 'stat', 'echo', 'cd',
  'basename', 'dirname', 'realpath', 'dir',
  'get-childitem', 'get-content', 'get-service', 'get-process',
  'get-location', 'get-command', 'get-item', 'get-nettcpconnection',
  'select-object', 'where-object', 'format-table', 'format-list',
  'measure-object', 'test-path', 'resolve-path', 'gci', 'gc',
]);

const GIT_SAFE = new Set([
  'status', 'diff', 'log', 'show', 'branch', 'rev-parse',
  'remote', 'fetch', 'ls-files', 'describe', 'config',
]);

// Subcomandos de gh que sólo leen. `gh pr create/merge/close` NO están aquí:
// son acciones con efecto en GitHub y el protocolo quiere verlas.
const GH_PR_SAFE = new Set(['view', 'list', 'diff', 'checks', 'status']);
const GH_RUN_SAFE = new Set(['list', 'view']);

// Scripts de npm que verifican y no escriben producto.
const NPM_RUN_SAFE = new Set(['lint', 'test', 'typecheck', 'test:unit', 'test:e2e']);

// Verbos de dotnet que compilan o prueban, pero no publican ni instalan nada.
const DOTNET_SAFE = new Set(['build', 'test', 'restore', 'format', '--version', '--info']);

// Subcomandos de prisma que NO tocan la base.
const PRISMA_SAFE = new Set(['generate', 'validate', 'format']);

// Subcomandos de docker que sólo miran.
const DOCKER_SAFE = new Set(['ps', 'logs', 'images', 'version', 'info']);
const DOCKER_COMPOSE_SAFE = new Set(['ps', 'logs', 'config', 'top', 'version']);

const DANGER = new RegExp(
  [
    String.raw`\brm\b|\brmdir\b|\bmv\b|\bdd\b|mkfs|\bchmod\b|\bchown\b|\bsudo\b`,
    String.raw`\bwget\b|\bcurl\b|--dangerously|>>|(?<!\d)>(?!\s*/dev/null)`,
    String.raw`\bgit\s+push\b|\bgit\s+reset\b|\bgit\s+clean\b|\bgit\s+rebase\b`,
    String.raw`\bkill\b|\btaskkill\b|\bpkill\b`,
    String.raw`\bset-content\b|\bremove-item\b|\bnew-item\b|\bout-file\b|\badd-content\b`,
    String.raw`\bif\b|\belse\b|\{|\}`,
    // Secretos del proyecto: cadena al SQL Server del cliente, API key de
    // sucursal, CSD del SAT, llaves del VPS.
    String.raw`\.env\b|\.pem\b|\.pfx\b|\.cer\b|id_rsa|\.ssh|\bssh\b|\bscp\b`,
    String.raw`secret|credential|password|api[-_]?key|connectionstring`,
    // Ejecución de código arbitrario.
    String.raw`\s-e\s|\s-c\s|--eval\b`,
    // Escrituras a la base o a servicios de verdad.
    String.raw`\bmigrate\b|\bdb\s+push\b|\bdb\s+seed\b|\bcompose\s+(up|down)\b`,
    // Arreglos automáticos: escriben código.
    String.raw`--fix\b|--write\b`,
  ].join('|'),
  'i',
);

function segOk(rawSeg) {
  const seg = rawSeg.trim();
  if (!seg) return true;

  const parts = seg.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = (i) => (parts[i] || '').toLowerCase();
  const isVersionProbe = () =>
    parts.slice(1).some((p) => ['--version', '-v', 'version', '--info'].includes(p.toLowerCase()));

  if (cmd === 'npm') {
    // npm run <script> de la lista blanca, con o sin -w/--workspace.
    if (arg(1) === 'run') {
      return parts.slice(2).some((p) => NPM_RUN_SAFE.has(p.toLowerCase()));
    }
    if (arg(1) === 'test') return true;
    if (arg(1) === 'ls' || arg(1) === 'list') return true;
    return isVersionProbe();
  }

  if (cmd === 'npx') {
    if (arg(1) === 'tsc') {
      return parts.slice(2).some((p) => p.toLowerCase() === '--noemit');
    }
    if (arg(1) === 'vitest') {
      // `vitest` a secas se queda en modo watch y nunca devuelve.
      return arg(2) === 'run';
    }
    if (arg(1) === 'jest') return true;
    if (arg(1) === 'eslint') return true;        // el --fix ya lo vetó DANGER
    if (arg(1) === 'prettier') {
      return parts.slice(2).some((p) => ['--check', '-c'].includes(p.toLowerCase()));
    }
    if (arg(1) === 'prisma') return PRISMA_SAFE.has(arg(2));
    return false;
  }

  if (cmd === 'dotnet') return DOTNET_SAFE.has(arg(1));

  if (cmd === 'docker') {
    if (arg(1) === 'compose') return DOCKER_COMPOSE_SAFE.has(arg(2));
    return DOCKER_SAFE.has(arg(1));
  }

  if (cmd === 'git') return GIT_SAFE.has(arg(1));

  if (cmd === 'gh') {
    if (arg(1) === 'pr') return GH_PR_SAFE.has(arg(2));
    if (arg(1) === 'run') return GH_RUN_SAFE.has(arg(2));
    if (arg(1) === 'auth') return arg(2) === 'status';
    return false;
  }

  if (cmd === 'node') return isVersionProbe();          // el -e/-p ya los vetó DANGER
  if (cmd.startsWith('$')) return true;                 // variable de PowerShell

  return SAFE.has(cmd);
}

function decide(cmd) {
  if (!cmd) return false;
  if (DANGER.test(cmd)) return false;
  return cmd.split(/&&|\|\||[;|]/).every(segOk);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw);
    const cmd = (data.tool_input || {}).command || '';
    if (decide(cmd)) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason:
            'Comando seguro (lectura / verificación) — auto-aprobado por el hook del proyecto.',
        },
      }));
    }
  } catch {
    // Fail-safe: si el JSON no parsea, no se aprueba nada y el flujo normal sigue.
  }
  process.exit(0);
});
