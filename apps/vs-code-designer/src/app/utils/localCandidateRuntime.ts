import path from 'path';
import { localize } from '../../localize';
import { ensureLocalCandidateInstalled, getLocalCandidate, type LocalCandidate } from './localCandidate';

let activeCandidate: LocalCandidate | undefined;
let selectedLspSdkPath: string | undefined;

export async function initializeLocalCandidateRuntime(): Promise<LocalCandidate | undefined> {
  selectedLspSdkPath = undefined;
  activeCandidate = await getLocalCandidate();
  if (activeCandidate) {
    Object.assign(process.env, getLocalCandidateHostEnvironment());
  }
  return activeCandidate;
}

export function getActiveLocalCandidate(): LocalCandidate | undefined {
  return activeCandidate;
}

export function isLocalCandidateManualMode(): boolean {
  return Boolean(activeCandidate && process.env.LOGICAPPS_LOCAL_CANDIDATE_MANUAL === 'true');
}

export function assertLocalCandidateProject(projectPath: string): void {
  if (!activeCandidate) {
    return;
  }
  const relative = path.relative(activeCandidate.root, path.resolve(projectPath));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(
      localize(
        'localCandidateProjectOutsideRoot',
        'Local candidate projects must be inside the isolated candidate root. Choose a folder inside "{0}" and try again. Selected path: "{1}".',
        activeCandidate.root,
        projectPath
      )
    );
  }
}

export function getLocalCandidateHostEnvironment(): Record<string, string> {
  if (!activeCandidate) {
    return {};
  }
  return {
    AzureFunctionsJobHost__extensionBundle__downloadPath: path.dirname(activeCandidate.bundlePath),
    AzureFunctionsJobHost__extensionBundle__version: `[${activeCandidate.bundle.version}]`,
    AzureFunctionsJobHost__extensionBundle__ensureLatest: 'false',
    // Core Tools 4.15.2's offline parser rejects exact four-part bundle versions.
    // Use its cache-first resolver without a connectivity probe or public fallback.
    FUNCTIONS_CORE_TOOLS_OFFLINE: 'false',
    FUNCTIONS_EXTENSIONBUNDLE_SOURCE_URI: 'http://127.0.0.1:1',
  };
}

export function recordLocalCandidateLspSdk(sdkPath: string): void {
  if (activeCandidate && path.resolve(sdkPath) !== path.resolve(activeCandidate.sdkPath)) {
    throw new Error('The language server selected an SDK outside the local candidate.');
  }
  selectedLspSdkPath = sdkPath;
}

export async function inspectLocalCandidate() {
  const candidate = await ensureLocalCandidateInstalled();
  if (!candidate) {
    throw new Error('No local candidate is configured.');
  }
  return {
    manifestPath: candidate.manifestPath,
    root: candidate.root,
    bundlePath: candidate.bundlePath,
    bundleVersion: candidate.bundle.version,
    sdkPath: candidate.sdkPath,
    sdkVersion: candidate.sdk.version,
    dependenciesPath: candidate.dependenciesPath,
    lspSdkPath: selectedLspSdkPath,
    missingPlatformAssets: candidate.missingPlatformAssets ?? [],
  };
}
