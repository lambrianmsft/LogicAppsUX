const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findProcessesUsingUserDataDir, assertNoActiveProfile } = require('../../../scripts/detect-active-candidate-profile');

const sampleUserDataDir = 'C:\\candidates\\root-1\\user-data';

function processes(commandLines) {
  return commandLines.map((commandLine, index) => ({ pid: 1000 + index, parentPid: 1, commandLine }));
}

test('findProcessesUsingUserDataDir matches an exact quoted --user-data-dir', () => {
  const matches = findProcessesUsingUserDataDir(
    sampleUserDataDir,
    processes([`"C:\\Program Files\\Microsoft VS Code\\Code.exe" --user-data-dir "${sampleUserDataDir}" --extensions-dir "C:\\x"`])
  );
  assert.equal(matches.length, 1);
});

test('findProcessesUsingUserDataDir matches an unquoted --user-data-dir', () => {
  const matches = findProcessesUsingUserDataDir(sampleUserDataDir, processes([`Code.exe --user-data-dir ${sampleUserDataDir}`]));
  assert.equal(matches.length, 1);
});

test('findProcessesUsingUserDataDir ignores an unrelated --user-data-dir', () => {
  const matches = findProcessesUsingUserDataDir(
    sampleUserDataDir,
    processes(['Code.exe --user-data-dir "C:\\candidates\\root-2\\user-data"'])
  );
  assert.equal(matches.length, 0);
});

test('findProcessesUsingUserDataDir ignores processes with no --user-data-dir at all', () => {
  const matches = findProcessesUsingUserDataDir(sampleUserDataDir, processes(['notepad.exe', 'explorer.exe']));
  assert.equal(matches.length, 0);
});

test('assertNoActiveProfile passes (read-only, no throw) when no process owns the profile', () => {
  const listProcessesImpl = () => processes(['Code.exe --user-data-dir "C:\\candidates\\root-2\\user-data"']);
  assert.doesNotThrow(() => assertNoActiveProfile(sampleUserDataDir, { listProcessesImpl }));
});

test('assertNoActiveProfile throws, naming the owning pid, when a process already owns the profile -- and never kills it', () => {
  const listProcessesImpl = () => processes([`"C:\\Program Files\\Microsoft VS Code\\Code.exe" --user-data-dir "${sampleUserDataDir}"`]);
  assert.throws(() => assertNoActiveProfile(sampleUserDataDir, { listProcessesImpl }), /refusing to launch a second one.*pid 1000/s);
});

test('assertNoActiveProfile surfaces multiple owning processes if more than one is found', () => {
  const listProcessesImpl = () =>
    processes([`Code.exe --user-data-dir "${sampleUserDataDir}"`, `Code.exe --user-data-dir "${sampleUserDataDir}"`]);
  let error;
  try {
    assertNoActiveProfile(sampleUserDataDir, { listProcessesImpl });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'expected assertNoActiveProfile to throw');
  assert.match(error.message, /pid 1000/);
  assert.match(error.message, /pid 1001/);
});
