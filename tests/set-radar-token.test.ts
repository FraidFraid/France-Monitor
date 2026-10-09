import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Script de pose du jeton Cloudflare Radar (tâche B10, preflight-B C2/P2) : jamais lancé contre la VM ici ;
// ssh, sudo, chown et systemctl sont simulés en tête du PATH (chmod, mktemp, grep et mv sont les vrais).
const SCRIPT = fileURLToPath(new URL('../deploy/oracle/set-radar-token.sh', import.meta.url));
const scriptText = (): string => readFileSync(SCRIPT, 'utf8');

/** Jeton factice de 40 caractères, de la forme d'un jeton Cloudflare (jamais un vrai jeton). */
const FAKE_TOKEN = 'FAKEtoken0123456789abcdefghijklmnop_-XYZ';
const ENV_BEFORE = 'A=1\nCLOUDFLARE_RADAR_TOKEN=ancien\nB=2\n';

let dir = '';
let fakeEnv = '';
let fakeLog = '';
let fakeArgv = '';
let fakeChown = '';

const writeExe = (name: string, body: string): void => {
  const p = join(dir, 'bin', name);
  writeFileSync(p, `#!/bin/bash\n${body}\n`);
  chmodSync(p, 0o755);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fm-radar-token-'));
  mkdirSync(join(dir, 'bin'));
  fakeEnv = join(dir, 'francemonitor.env');
  fakeLog = join(dir, 'systemctl.log');
  fakeArgv = join(dir, 'ssh-argv.log');
  fakeChown = join(dir, 'chown.log');
  writeFileSync(fakeEnv, ENV_BEFORE);
  // ssh : note ses arguments, ignore -i/-o/hôte, remplace le chemin du fichier d'environnement par FAKE_ENV dans la commande distante
  // (dernier argument) puis l'exécute par bash -c, l'entrée standard passant telle quelle comme sur la VM.
  writeExe('ssh', [
    'printf "%s\\n" "$@" >> "$FAKE_ARGV"',
    'cmd="${@: -1}"',
    'cmd="${cmd//\\/etc\\/francemonitor\\/francemonitor.env/$FAKE_ENV}"',
    'exec bash -c "$cmd"',
  ].join('\n'));
  writeExe('sudo', 'exec "$@"');
  // chown root:fm : impossible hors root ; note ses arguments (FAKE_CHOWN_FAIL=1 simule un échec après la création du temporaire).
  writeExe('chown', 'echo "$*" >> "$FAKE_CHOWN"; [ "${FAKE_CHOWN_FAIL:-0}" = 0 ]');
  writeExe('systemctl', 'echo "$*" >> "$FAKE_LOG"');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (input: string, extraEnv: Record<string, string> = {}) => spawnSync('bash', [SCRIPT], {
  input,
  encoding: 'utf8',
  env: {
    ...process.env,
    ...extraEnv,
    FAKE_CHOWN: fakeChown,
    PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
    FAKE_ENV: fakeEnv,
    FAKE_LOG: fakeLog,
    FAKE_ARGV: fakeArgv,
    FM_VM_HOST: 'test@vm.invalid',
    FM_VM_KEY: join(dir, 'cle-factice'),
  },
});

describe('deploy/oracle/set-radar-token.sh : texte du script', () => {
  it('lit le jeton sans écho (terminal) ou sur l’entrée standard, le transmet par l’entrée standard de ssh, ne l’affiche jamais', () => {
    const t = scriptText();
    expect(t).toContain('IFS= read -rs TOKEN');
    expect(t).toContain('[ -t 0 ]');
    expect(t).toContain(`printf '%s\\n' "$TOKEN" | ssh`);
    expect(t).toContain('-o BatchMode=yes');
    expect(t).toContain('ENV=/etc/francemonitor/francemonitor.env');
    expect(t).toContain('CLOUDFLARE_RADAR_TOKEN=');
    expect(t).toContain('TMP=$(mktemp "${ENV%/*}/.francemonitor.env.XXXXXX")');
    expect(t).toContain('trap cleanup EXIT');
    expect(t).toContain('chown root:fm "$TMP"');
    expect(t).toContain('chmod 640 "$TMP"');
    expect(t).toContain('mv -f "$TMP" "$ENV"');
    expect(t).not.toContain('install ');
    expect(t).not.toMatch(/> "\$TMP" \|\| true/);
    expect(t).toContain('systemctl restart fm-api');
    expect(t).not.toMatch(/echo "?\$TOKEN/);
    expect(t).not.toMatch(/Authorization|rejectUnauthorized|curl /);
  });

  it('aucune valeur de jeton dans le dépôt : pas de suite de 30 caractères de jeton', () => {
    expect(scriptText()).not.toMatch(/[A-Za-z0-9_-]{30,}/);
  });

  it('ni tiret cadratin ni syntaxe invalide (bash -n)', () => {
    expect(scriptText()).not.toContain('\u2014');
    const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });
});

/** Temporaires laissés dans le dossier du fichier d'environnement (aucun attendu, succès comme échec). */
const leftovers = (): string[] => readdirSync(dir).filter((f) => f.startsWith('.francemonitor.env.'));

describe('deploy/oracle/set-radar-token.sh : commandes simulées', () => {
  it('jeton de 40 caractères suivi d’un saut de ligne : ancienne ligne remplacée, autres gardées, fm-api redémarré, jeton jamais affiché ni en argument', () => {
    const r = run(`${FAKE_TOKEN}\n`);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(fakeEnv, 'utf8')).toBe(`A=1\nB=2\nCLOUDFLARE_RADAR_TOKEN=${FAKE_TOKEN}\n`);
    expect(readFileSync(fakeLog, 'utf8')).toBe('restart fm-api\n');
    expect(statSync(fakeEnv).mode & 0o777).toBe(0o640);
    expect(readFileSync(fakeChown, 'utf8')).toMatch(/^root:fm .*\/\.francemonitor\.env\.[A-Za-z0-9]+\n$/);
    expect(leftovers()).toEqual([]);
    expect(r.stdout).toContain('Jeton posé, fm-api redémarré.');
    expect(r.stdout).not.toContain(FAKE_TOKEN);
    expect(r.stderr).not.toContain(FAKE_TOKEN);
    expect(readFileSync(fakeArgv, 'utf8')).not.toContain(FAKE_TOKEN);
  });

  it('jeton collé sans saut de ligne final (cas pbpaste) : posé une seule fois', () => {
    const r = run(FAKE_TOKEN);
    expect(r.status, r.stderr).toBe(0);
    const lines = readFileSync(fakeEnv, 'utf8').split('\n').filter((l) => l.startsWith('CLOUDFLARE_RADAR_TOKEN='));
    expect(lines).toEqual([`CLOUDFLARE_RADAR_TOKEN=${FAKE_TOKEN}`]);
  });

  it('entrée vide : code 1, « Jeton vide », fichier inchangé, systemctl jamais appelé', () => {
    const r = run('');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Jeton vide');
    expect(readFileSync(fakeEnv, 'utf8')).toBe(ENV_BEFORE);
    expect(existsSync(fakeLog)).toBe(false);
    expect(existsSync(fakeArgv)).toBe(false);
  });

  it('entrée « bonjour » : code 1, « ne ressemble pas », rien d’écrit, texte refusé jamais répété', () => {
    const r = run('bonjour\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ne ressemble pas');
    expect(r.stderr).not.toContain('bonjour');
    expect(readFileSync(fakeEnv, 'utf8')).toBe(ENV_BEFORE);
    expect(existsSync(fakeLog)).toBe(false);
    expect(existsSync(fakeArgv)).toBe(false);
  });

  it('blancs de début et de fin (retour chariot d’un collage) retirés : jeton posé tel quel', () => {
    const r = run(`  ${FAKE_TOKEN} \r\n`);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(fakeEnv, 'utf8')).toBe(`A=1\nB=2\nCLOUDFLARE_RADAR_TOKEN=${FAKE_TOKEN}\n`);
  });

  it('collage « Bearer <jeton> », « Bearer<jeton> » ou blanc interne : code 1, refusé sans afficher le texte, rien d’écrit', () => {
    for (const input of [`Bearer ${FAKE_TOKEN}\n`, `Bearer${FAKE_TOKEN}\n`, `${FAKE_TOKEN.slice(0, 20)} ${FAKE_TOKEN.slice(20)}\n`]) {
      const r = run(input);
      expect(r.status, input).toBe(1);
      expect(r.stderr).toContain('contient un blanc ou le mot Bearer');
      expect(r.stderr).not.toContain(FAKE_TOKEN.slice(0, 20));
      expect(r.stdout).not.toContain(FAKE_TOKEN.slice(0, 20));
      expect(readFileSync(fakeEnv, 'utf8')).toBe(ENV_BEFORE);
      expect(existsSync(fakeArgv)).toBe(false);
    }
  });

  it('fichier d’environnement absent sur la VM : code 1, rien n’est créé, fm-api non redémarré', () => {
    rmSync(fakeEnv);
    const r = run(`${FAKE_TOKEN}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('absent ou illisible');
    expect(r.stderr).not.toContain(FAKE_TOKEN);
    expect(existsSync(fakeEnv)).toBe(false);
    expect(existsSync(fakeLog)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('fichier d’environnement illisible : code 1, fichier inchangé, fm-api non redémarré, aucun temporaire', () => {
    chmodSync(fakeEnv, 0o000);
    const r = run(`${FAKE_TOKEN}\n`);
    chmodSync(fakeEnv, 0o600);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/absent ou illisible|Lecture du fichier d’environnement impossible/);
    expect(readFileSync(fakeEnv, 'utf8')).toBe(ENV_BEFORE);
    expect(existsSync(fakeLog)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('échec après la création du temporaire (chown) : copie des secrets supprimée, fichier inchangé, fm-api non redémarré', () => {
    const r = run(`${FAKE_TOKEN}\n`, { FAKE_CHOWN_FAIL: '1' });
    expect(r.status).not.toBe(0);
    expect(existsSync(fakeChown)).toBe(true);
    expect(leftovers()).toEqual([]);
    expect(readFileSync(fakeEnv, 'utf8')).toBe(ENV_BEFORE);
    expect(existsSync(fakeLog)).toBe(false);
  });
});
