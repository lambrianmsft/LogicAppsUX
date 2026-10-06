import * as cp from 'child_process';
import * as path from 'path';
import { ext } from '../../../extensionVariables';
import { getExtensionAssetPath } from '../extensionAssets';
import { localize } from '../../../localize';

interface ProcessInfo {
  processId: number;
  name: string;
  parentProcessId: number;
}

async function runPowerShellScript(scriptPath: string, ...args: string[]): Promise<string> {
  if (!process.env.SystemRoot) {
    throw new Error('Windows SystemRoot is required to locate Windows PowerShell for process discovery.');
  }
  const powershell = path.win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const commandArgs = ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args];
    const target = args[0] === '-ListeningPort' ? `port "${args[1]}"` : `parent PID "${args[0]}"`;

    ext.outputChannel.appendLog(`Executing PowerShell script: "${scriptPath}" for ${target}.`);

    cp.execFile(
      powershell,
      commandArgs,
      {
        timeout: 10000,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024, // 1MB buffer
      },
      (error, stdout, stderr) => {
        if (error) {
          ext.outputChannel.appendLog(`PowerShell script error: ${error.message}`);
          if (stderr) {
            ext.outputChannel.appendLog(`PowerShell stderr: ${stderr}`);
          }
          reject(
            error.killed && typeof error.code !== 'string'
              ? new Error(`PowerShell process discovery timed out after 10000 ms for ${target}.`)
              : error
          );
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
}

export async function getListeningProcessIds(port: number): Promise<number[]> {
  const output = await runPowerShellScript(getExtensionAssetPath('scripts', 'get-child-processes.ps1'), '-ListeningPort', String(port));
  const owners: unknown = JSON.parse(output);
  if (!Array.isArray(owners) || !owners.every((owner) => Number.isInteger(owner) && owner > 0)) {
    throw new Error('PowerShell returned invalid listening process IDs.');
  }
  return owners;
}

export async function getChildProcesses(parentProcessId: number): Promise<ProcessInfo[]> {
  try {
    const scriptPath = getExtensionAssetPath('scripts', 'get-child-processes.ps1');
    const output = await runPowerShellScript(scriptPath, parentProcessId.toString());

    if (!output || output === '[]') {
      return [];
    }

    const rawData = JSON.parse(output);
    const dataArray = Array.isArray(rawData) ? rawData : [rawData];

    return dataArray.map((item: any) => ({
      processId: item.ProcessId,
      name: item.Name,
      parentProcessId: item.ParentProcessId,
    }));
  } catch (error) {
    throw new Error(
      localize(
        'getChildProcessesError',
        'Failed to execute Powershell script to get the func child process. Error: "{0}".',
        error instanceof Error ? error.message : String(error)
      )
    );
  }
}
