/**
 * Programmatic launcher for chat E2E tests.
 *
 * Mirrors the F5 "Chat Tests (Extension Host)" debug config but runs
 * headlessly from the terminal. Uses your real VS Code user-data-dir
 * and extensions-dir so Copilot auth and LLM models are available.
 *
 * Usage: node run-chat-tests.js
 */
const { runTests } = require('@vscode/test-electron');
const path = require('path');
const os = require('os');

async function main() {
  const projectDir = __dirname;

  // Same paths as launch.json "Chat Tests (Extension Host)"
  const extensionDevelopmentPath = path.join(projectDir, 'dist');
  const extensionTestsPath = path.join(projectDir, 'out', 'test', 'e2e', 'runChatTests');
  const workspacePath = path.join(projectDir, 'e2e', 'test-workspace');

  // Reuse the real VS Code user-data and extensions so Copilot is available
  const userDataDir =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Code')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'Code')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Code');

  const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');

  console.log('=== Chat E2E Test Launcher ===');
  console.log(`Extension:     ${extensionDevelopmentPath}`);
  console.log(`Tests:         ${extensionTestsPath}`);
  console.log(`Workspace:     ${workspacePath}`);
  console.log(`User data:     ${userDataDir}`);
  console.log(`Extensions:    ${extensionsDir}`);
  console.log();

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath, '--disable-gpu', '--disable-updates', '--user-data-dir', userDataDir, '--extensions-dir', extensionsDir],
    });
    console.log('\n✓ All tests passed');
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Tests failed:', err);
    process.exit(1);
  }
}

main();
