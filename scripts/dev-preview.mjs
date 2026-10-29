import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// This launcher always uses the restored local copy, regardless of inherited DATA_DIR.
const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'data', 'preview-20261029');
if (!fs.existsSync(path.join(directory, 'restore.json'))) throw new Error('Restore the local preview backup before starting.');
if (process.env.NODE_ENV === 'production') throw new Error('This launcher is for local development only.');
const savedPort = fs.existsSync(path.join(directory, 'dev.port')) ? fs.readFileSync(path.join(directory, 'dev.port'), 'utf8').trim() : '0';
const port = process.argv[2] || savedPort;
if (!/^\d+$/.test(port) || Number(port) > 65535) throw new Error('Supply a local port number.');
const child = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', '--port', port], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, DATA_DIR: directory, DV_FREE_MOVE: 'off', DV_RO_WORKERS: '2' },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
