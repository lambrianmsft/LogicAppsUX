/**
 * Chat test runner for Extension Development Host.
 *
 * Results are written to chat-test-results.log for automated reading.
 */

import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

const LOG_FILE = path.resolve(__dirname, '..', '..', '..', 'chat-test-results.log');

function log(msg: string): void {
  console.log(msg);
  try {
    fs.appendFileSync(
      LOG_FILE,
      `${msg}
`
    );
  } catch {
    /* ignore */
  }
}

export async function run(): Promise<void> {
  fs.writeFileSync(LOG_FILE, `Chat Test Run: ${new Date().toISOString()}\n\n`);

  const mocha = new Mocha({
    ui: 'tdd',
    timeout: 180_000,
    color: false,
  });

  const testsRoot = path.resolve(__dirname);
  mocha.addFile(path.join(testsRoot, 'integration', 'chatParticipant.test.js'));
  log('[chat-tests] Extension-host Chat Tests do not capture screenshots; run E2E_MODE=chatonly ExTester for UI screenshots.');
  log('[chat-tests] Shared ChatScenario fixtures are currently exercised on the ExTester surface only.');

  // Hook console.log so test output goes to file
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    origLog(...args);
    try {
      fs.appendFileSync(LOG_FILE, `${args.map(String).join(' ')}\n`);
    } catch {
      /* ignore */
    }
  };

  return new Promise<void>((resolve, reject) => {
    const runner = mocha.run((failures) => {
      console.log = origLog;
      log(`\n=== DONE: ${failures} failure(s) ===`);

      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed. See ${LOG_FILE}`));
      } else {
        resolve();
      }
    });

    // Log test events directly
    runner.on('suite', (suite) => {
      if (suite.title) {
        log(`\n  ${suite.title}`);
      }
    });
    runner.on('pass', (test) => {
      log(`    ✓ ${test.title} (${test.duration}ms)`);
    });
    runner.on('fail', (test, err) => {
      log(`    ✗ ${test.title}`);
      log(`      Error: ${err.message}`);
      if (err.stack) {
        const stackDetails = err.stack
          .split('\n')
          .slice(1)
          .map((line: string) => `        ${line.trim()}`)
          .join('\n');
        if (stackDetails) {
          log(stackDetails);
        }
      }
    });
    runner.on('pending', (test) => {
      log(`    - ${test.title} (skipped)`);
    });
    runner.on('end', () => {
      log(`\n  ${runner.stats?.passes} passing (${Math.round((runner.stats?.duration ?? 0) / 1000)}s)`);
      if (runner.stats?.pending) {
        log(`  ${runner.stats.pending} pending`);
      }
      if (runner.stats?.failures) {
        log(`  ${runner.stats.failures} failing`);
      }
    });
  });
}
