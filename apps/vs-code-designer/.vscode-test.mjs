import { defineConfig } from '@vscode/test-cli';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  {
    label: 'unitTests',
    files: 'out/test/e2e/**/*.test.js',
    version: 'stable',
    workspaceFolder: path.join(__dirname, 'e2e', 'test-workspace'),
    mocha: {
      ui: 'tdd',
      timeout: 60000,
    },
    launchArgs: [
      '--disable-extensions', // Disable other extensions to speed up tests
      '--user-data-dir', path.join(__dirname, '.vscode-test', 'user-data'),
      '--extensions-dir', path.join(__dirname, '.vscode-test', 'extensions'),
      '--disable-gpu', // Helps with stability in CI
      '--disable-updates', // Prevent update checks
    ],
  },
  {
    label: 'integrationTests',
    files: 'out/test/e2e/integration/**/*.test.js',
    version: 'stable',
    workspaceFolder: path.join(__dirname, 'e2e', 'test-workspace'),
    mocha: {
      ui: 'tdd',
      timeout: 120000,
    },
    launchArgs: [
      '--user-data-dir', path.join(__dirname, '.vscode-test', 'user-data'),
      '--extensions-dir', path.join(__dirname, '.vscode-test', 'extensions'),
      '--disable-gpu',
      '--disable-updates',
    ],
  },
  {
    // Chat tests: loads our extension from dist/ and opens the test-workspace
    // which contains a valid Logic App project (host.json + Stateful1 workflow).
    //
    // To get Copilot + GitHub auth, point to the real VS Code extensions dir
    // and a COPY of the user-data-dir (to avoid "only one instance" conflict).
    //
    // Before running: close VS Code, or run the copy script:
    //   node -e "require('fs').cpSync(process.env.APPDATA+'/Code', '.vscode-test/chat-user-data', {recursive:true, force:true})"
    label: 'chatTests',
    files: 'out/test/e2e/integration/chatParticipant.test.js',
    version: '1.110.0',
    extensionDevelopmentPath: path.join(__dirname, 'dist'),
    workspaceFolder: path.join(__dirname, 'e2e', 'test-workspace', 'test-workspace.code-workspace'),
    mocha: {
      ui: 'tdd',
      timeout: 180000,
    },
    launchArgs: [
      '--disable-gpu',
      '--disable-updates',
    ],
  },
]);
