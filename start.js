// Launcher: completely removes ELECTRON_RUN_AS_NODE so Electron starts in normal mode
const { spawn } = require('child_process');
const path = require('path');

const electron = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
const args = process.argv.slice(2);

// Build clean env: delete ELECTRON_RUN_AS_NODE entirely (setting to '0' is NOT enough)
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...args], {
  stdio: 'inherit',
  cwd: __dirname,
  env: cleanEnv,
});
child.on('exit', code => process.exit(code));
