#!/usr/bin/env node
// Read-only check: does an existing VS Code main process already own the given
// --user-data-dir? No existing code in this repo performs this check (confirmed by
// search); it is new, narrowly-scoped functionality built to prevent the previously
// observed failure mode where relaunching with a --user-data-dir that is already in use
// causes VS Code to silently attach to/reuse the existing window and ignore the new
// candidate selection's launch arguments and environment variables -- producing a
// misleadingly "successful" launch that is not actually running against the intended
// candidate.
//
// This module only reports; it never kills, signals, or otherwise touches any process.
// Process enumeration is injectable so tests never spawn a real PowerShell/ps process.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * List running processes as { pid, parentPid, commandLine } using a single read-only
 * enumeration call appropriate to the current platform. Exposed so callers/tests can
 * inject a stub instead of actually enumerating this machine's processes.
 */
function listProcessesWindows(spawnSyncImpl = spawnSync) {
  const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress -Depth 2';
  const result = spawnSyncImpl(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  if (result.error || result.status !== 0) {
    throw new Error(`Could not enumerate processes read-only: ${result.error ? result.error.message : `exit ${result.status}`}`);
  }
  const parsed = JSON.parse(result.stdout.toString('utf8') || '[]');
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => ({ pid: row.ProcessId, parentPid: row.ParentProcessId, commandLine: row.CommandLine || '' }));
}

function listProcessesPosix(spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl('ps', ['-axo', 'pid=,ppid=,command=']);
  if (result.error || result.status !== 0) {
    throw new Error(`Could not enumerate processes read-only: ${result.error ? result.error.message : `exit ${result.status}`}`);
  }
  return result.stdout
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return match ? { pid: Number(match[1]), parentPid: Number(match[2]), commandLine: match[3] } : null;
    })
    .filter(Boolean);
}

function listProcesses(spawnSyncImpl = spawnSync) {
  return process.platform === 'win32' ? listProcessesWindows(spawnSyncImpl) : listProcessesPosix(spawnSyncImpl);
}

/**
 * Does any currently running process's command line reference the exact given
 * --user-data-dir path (either quoted or unquoted, matching how VS Code and the
 * run-candidate-e2e launch invocation both pass it)? Comparison is on the normalized
 * absolute path, not a literal string, so differing quoting/trailing slashes don't cause
 * a false negative.
 */
function findProcessesUsingUserDataDir(userDataDir, processes) {
  const normalized = path.normalize(userDataDir).toLowerCase();
  const pattern = /--user-data-dir[= ]"?([^"]+?)"?(?:\s+--|\s*$)/i;
  return processes.filter((proc) => {
    const match = proc.commandLine.match(pattern);
    return match && path.normalize(match[1]).toLowerCase() === normalized;
  });
}

/**
 * Read-only guard: throws, naming the exact owning PID(s) and command line(s), if a
 * process is already running against the given --user-data-dir. Callers must refuse to
 * launch when this throws; it never kills or signals anything itself. Reports only --
 * resolving a conflict (if one is wanted) is a decision for whoever reads this error
 * message, as explicitly scoped by the parent.
 */
function assertNoActiveProfile(userDataDir, { listProcessesImpl = listProcesses } = {}) {
  const matches = findProcessesUsingUserDataDir(userDataDir, listProcessesImpl());
  if (matches.length) {
    const description = matches.map((proc) => `pid ${proc.pid} (parent ${proc.parentPid}): ${proc.commandLine}`).join('\n  ');
    throw new Error(
      `An existing process already uses --user-data-dir ${userDataDir}; refusing to launch a second one against the same ` +
        `profile (it would silently attach to or reuse the existing window and ignore this candidate's launch arguments). ` +
        `Owning process(es):\n  ${description}\nClose that window/process yourself, or launch against a different root, before retrying.`
    );
  }
}

module.exports = {
  listProcessesWindows,
  listProcessesPosix,
  listProcesses,
  findProcessesUsingUserDataDir,
  assertNoActiveProfile,
};
