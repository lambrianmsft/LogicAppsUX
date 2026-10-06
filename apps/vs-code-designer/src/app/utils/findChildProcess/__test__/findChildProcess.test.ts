import * as cp from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ext } from '../../../../extensionVariables';

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof cp>()),
  execFile: vi.fn(),
}));

vi.mock('../../extensionAssets', () => ({
  getExtensionAssetPath: vi.fn(),
}));

import { getExtensionAssetPath } from '../../extensionAssets';
import { getChildProcesses, getListeningProcessIds } from '../findChildProcess';

describe('getChildProcesses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    vi.mocked(getExtensionAssetPath).mockReturnValue('C:\\mock space & symbols\\get-child-processes.ps1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  function complete(stdout: string, error: cp.ExecFileException | null = null, stderr = '') {
    vi.mocked(cp.execFile).mockImplementation((_file, _args, _options, callback) => {
      callback?.(error, stdout, stderr);
      return new cp.ChildProcess();
    });
  }

  it('passes script paths and PID as literal arguments to the directly timed PowerShell process', async () => {
    complete('[{"ProcessId":111,"Name":"func.exe","ParentProcessId":100},{"ProcessId":222,"Name":"dotnet.exe","ParentProcessId":111}]');
    await expect(getChildProcesses(100)).resolves.toEqual([
      { processId: 111, name: 'func.exe', parentProcessId: 100 },
      { processId: 222, name: 'dotnet.exe', parentProcessId: 111 },
    ]);
    expect(cp.execFile).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      [
        '-NoProfile',
        '-NoLogo',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:\\mock space & symbols\\get-child-processes.ps1',
        '100',
      ],
      { timeout: 10000, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      expect.any(Function)
    );
  });

  it('leaves no backup timer after successful discovery', async () => {
    vi.useFakeTimers();
    complete('[]');
    await expect(getChildProcesses(100)).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports deadline and parent PID without hiding discovery failure as no children', async () => {
    complete('', Object.assign(new Error('Command failed'), { killed: true }));
    await expect(getChildProcesses(100)).rejects.toThrow('timed out after 10000 ms for parent PID "100"');
  });

  it('preserves command error and stderr instead of returning an empty process list', async () => {
    complete('', Object.assign(new Error('CIM query failed'), { code: 1 }), 'Access denied');
    await expect(getChildProcesses(100)).rejects.toThrow('CIM query failed');
    expect(ext.outputChannel.appendLog).toHaveBeenCalledWith('PowerShell stderr: Access denied');
  });

  it('does not misreport a killed output-buffer overflow as a timeout', async () => {
    complete('', Object.assign(new Error('stdout maxBuffer length exceeded'), { killed: true, code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
    await expect(getChildProcesses(100)).rejects.toThrow('stdout maxBuffer length exceeded');
  });

  it('fails explicitly without Windows SystemRoot instead of depending on PATH', async () => {
    vi.stubEnv('SystemRoot', undefined);
    await expect(getChildProcesses(100)).rejects.toThrow('Windows SystemRoot is required');
    expect(cp.execFile).not.toHaveBeenCalled();
  });

  it('queries listening owners without silently accepting malformed discovery output', async () => {
    complete('[222]');
    await expect(getListeningProcessIds(7071)).resolves.toEqual([222]);
    expect(cp.execFile).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.arrayContaining(['-ListeningPort', '7071']),
      expect.any(Object),
      expect.any(Function)
    );
    complete('[]');
    await expect(getListeningProcessIds(7071)).resolves.toEqual([]);
    complete('{"OwningProcess":222}');
    await expect(getListeningProcessIds(7071)).rejects.toThrow('invalid listening process IDs');
  });
});
