import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Script de pose du jeton Cloudflare Radar (tâche B10, preflight-B C2/P2) : jamais lancé contre la VM ici ;
// ssh, sudo, install et systemctl sont simulés en tête du PATH.
const SCRIPT = fileURLToPath(new URL('../deploy/oracle/set-radar-token.sh', import.meta.url));
const scriptText = (): string => readFileSync(SCRIPT, 'utf8');

/** Jeton factice de 40 caractères, de la forme d'un jeton Cloudflare (jamais un vrai jeton). */
const FAKE_TOKEN = 'FAKEtoken0123456789abcdefghijklmnop_-XYZ';
const ENV_BEFORE = 'A=1\nCLOUDFLARE_RADAR_TOKEN=ancien\nB=2\n';

let dir = '';
let fakeEnv = '';
let fakeLog = '';
let fakeArgv = '';

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
  // install -o root -g fm -m 640 SRC DEST : copie l'avant-dernier argument vers le dernier.
  writeExe('install', 'args=("$@"); n=${#args[@]}; cp "${args[$((n-2))]}" "${args[$((n-1))]}"');
  writeExe('systemctl', 'echo "$*" >> "$FAKE_LOG"');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (input: string) => spawnSync('bash', [SCRIPT], {
  input,
  encoding: 'utf8',
  env: {
    ...process.env,
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
    expect(t).toContain('install -o root -g fm -m 640');
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

describe('deploy/oracle/set-radar-token.sh : commandes simulées', () => {
  it('jeton de 40 caractères suivi d’un saut de ligne : ancienne ligne remplacée, autres gardées, fm-api redémarré, jeton jamais affiché ni en argument', () => {
    const r = run(`${FAKE_TOKEN}\n`);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(fakeEnv, 'utf8')).toBe(`A=1\nB=2\nCLOUDFLARE_RADAR_TOKEN=${FAKE_TOKEN}\n`);
    expect(readFileSync(fakeLog, 'utf8')).toBe('restart fm-api\n');
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
});
