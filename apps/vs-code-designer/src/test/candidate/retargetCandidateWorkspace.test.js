const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { parseArgs, readCandidateFacts, retargetCodefulProject } = require('../../../scripts/retarget-candidate-workspace');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Mirrors the real emitted shape: CreateLogicAppWorkspace.ts always appends a
// packageSourceMapping block when a candidate is active.
function writeGeneratedProject(projectPath, { version, lspDirectoryPath, packageId = 'Microsoft.Azure.Workflows.Sdk' }) {
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'MyLogicApp.csproj'),
    [
      '<Project Sdk="Microsoft.NET.Sdk">',
      '  <ItemGroup>',
      '    <FrameworkReference Include="Microsoft.AspNetCore.App" />',
      '    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.21.0" />',
      `    <PackageReference Include="${packageId}" Version="${version}"/>`,
      '  </ItemGroup>',
      '</Project>',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(projectPath, 'nuget.config'),
    [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<configuration>',
      '    <config>',
      '        <add key="globalPackagesFolder" value=".nuget\\packages" />',
      '    </config>',
      '    <packageSources>',
      `        <add key="current" value="${lspDirectoryPath}" />`,
      '    </packageSources>',
      '<packageSourceMapping>',
      '  <clear />',
      `  <packageSource key="current"><package pattern="${packageId}" /></packageSource>`,
      '  <packageSource key="nuget.org"><package pattern="*" /></packageSource>',
      '</packageSourceMapping>',
      '</configuration>',
      '',
    ].join('\n')
  );
}

test('parseArgs requires all three absolute arguments', () => {
  assert.throws(() => parseArgs([]), /--project is required/);
  assert.throws(() => parseArgs(['--project', 'relative']), /must be an absolute path/);
});

test('readCandidateFacts derives version and LSP directory from manifest + root', () => {
  const root = makeTempDir('candidate-facts-');
  const manifestPath = path.join(root, 'candidate.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ schemaVersion: 1, sdk: { packageId: 'Microsoft.Azure.Workflows.Sdk', version: '1.0.0-e2e.new1' } })
  );
  const candidateRoot = path.join(root, 'candidate-root');
  const facts = readCandidateFacts(manifestPath, candidateRoot);
  assert.equal(facts.packageId, 'Microsoft.Azure.Workflows.Sdk');
  assert.equal(facts.version, '1.0.0-e2e.new1');
  assert.equal(facts.lspDirectoryPath, path.join(candidateRoot, 'dependencies', 'LanguageServerLogicApps'));
});

test('readCandidateFacts rejects a manifest with the wrong package id', () => {
  const root = makeTempDir('candidate-facts-');
  const manifestPath = path.join(root, 'candidate.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, sdk: { packageId: 'Not.The.Sdk', version: '1.0.0' } }));
  assert.throws(() => readCandidateFacts(manifestPath, root), /packageId must be/);
});

test('retargetCodefulProject rewrites an OLD candidate version/path to a NEW one', () => {
  const root = makeTempDir('retarget-');
  const projectPath = path.join(root, 'project');
  const oldLsp = path.join(root, 'old-candidate', 'dependencies', 'LanguageServerLogicApps');
  writeGeneratedProject(projectPath, { version: '1.0.0-e2e.old0.bpm005', lspDirectoryPath: oldLsp });

  const newCandidate = {
    packageId: 'Microsoft.Azure.Workflows.Sdk',
    version: '1.0.0-e2e.ff748b0.jsonboundary1',
    lspDirectoryPath: path.join(root, 'new-candidate', 'dependencies', 'LanguageServerLogicApps'),
  };
  const result = retargetCodefulProject(projectPath, newCandidate);

  assert.equal(result.csproj.changed, true);
  assert.equal(result.csproj.oldVersion, '1.0.0-e2e.old0.bpm005');
  assert.equal(result.csproj.newVersion, newCandidate.version);
  assert.equal(result.nugetConfig.changed, true);
  assert.equal(result.nugetConfig.oldSource, oldLsp);
  assert.equal(result.nugetConfig.newSource, newCandidate.lspDirectoryPath);

  const csprojContent = fs.readFileSync(path.join(projectPath, 'MyLogicApp.csproj'), 'utf8');
  assert.match(csprojContent, new RegExp(`Include="Microsoft.Azure.Workflows.Sdk" Version="${escapeRegExp(newCandidate.version)}"`));
  assert.doesNotMatch(csprojContent, /1\.0\.0-e2e\.old0\.bpm005/);
  // Unrelated PackageReference entries must be preserved untouched.
  assert.match(csprojContent, /Include="Microsoft.Azure.Functions.Worker" Version="1.21.0"/);

  const nugetContent = fs.readFileSync(path.join(projectPath, 'nuget.config'), 'utf8');
  assert.match(nugetContent, new RegExp(`key="current" value="${escapeRegExp(newCandidate.lspDirectoryPath)}"`));
  assert.doesNotMatch(nugetContent, new RegExp(escapeRegExp(oldLsp)));
  // globalPackagesFolder is project-relative and must be preserved untouched.
  assert.match(nugetContent, /key="globalPackagesFolder" value="\.nuget\\packages"/);
});

test('retargetCodefulProject is a no-op (changed: false) when already pointing at the given candidate', () => {
  const root = makeTempDir('retarget-noop-');
  const projectPath = path.join(root, 'project');
  const candidate = {
    packageId: 'Microsoft.Azure.Workflows.Sdk',
    version: '1.0.0-e2e.same1',
    lspDirectoryPath: path.join(root, 'candidate', 'dependencies', 'LanguageServerLogicApps'),
  };
  writeGeneratedProject(projectPath, { version: candidate.version, lspDirectoryPath: candidate.lspDirectoryPath });

  const before = {
    csproj: fs.readFileSync(path.join(projectPath, 'MyLogicApp.csproj'), 'utf8'),
    nuget: fs.readFileSync(path.join(projectPath, 'nuget.config'), 'utf8'),
  };
  const result = retargetCodefulProject(projectPath, candidate);
  assert.equal(result.csproj.changed, false);
  assert.equal(result.nugetConfig.changed, false);
  assert.equal(fs.readFileSync(path.join(projectPath, 'MyLogicApp.csproj'), 'utf8'), before.csproj);
  assert.equal(fs.readFileSync(path.join(projectPath, 'nuget.config'), 'utf8'), before.nuget);
});

test('retargetCodefulProject tolerates a nuget.config with no packageSourceMapping block', () => {
  const root = makeTempDir('retarget-no-mapping-');
  const projectPath = path.join(root, 'project');
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'MyLogicApp.csproj'),
    '<Project><ItemGroup><PackageReference Include="Microsoft.Azure.Workflows.Sdk" Version="1.0.0-preview.1"/></ItemGroup></Project>\n'
  );
  const oldLsp = path.join(root, 'old-candidate', 'dependencies', 'LanguageServerLogicApps');
  fs.writeFileSync(
    path.join(projectPath, 'nuget.config'),
    `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n    <config>\n        <add key="globalPackagesFolder" value=".nuget\\packages" />\n    </config>\n    <packageSources>\n        <add key="current" value="${oldLsp}" />\n    </packageSources>\n</configuration>\n`
  );

  const newCandidate = {
    packageId: 'Microsoft.Azure.Workflows.Sdk',
    version: '1.0.0-e2e.new2',
    lspDirectoryPath: path.join(root, 'new-candidate', 'dependencies', 'LanguageServerLogicApps'),
  };
  const result = retargetCodefulProject(projectPath, newCandidate);
  assert.equal(result.csproj.changed, true);
  assert.equal(result.nugetConfig.changed, true);
});

test('retargetCodefulProject throws rather than guessing when the csproj has no recognizable SDK PackageReference', () => {
  const root = makeTempDir('retarget-unrecognized-');
  const projectPath = path.join(root, 'project');
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'MyLogicApp.csproj'), '<Project><ItemGroup></ItemGroup></Project>\n');
  fs.writeFileSync(
    path.join(projectPath, 'nuget.config'),
    '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n    <packageSources>\n        <add key="current" value="C:\\x" />\n    </packageSources>\n</configuration>\n'
  );
  const candidate = { packageId: 'Microsoft.Azure.Workflows.Sdk', version: '1.0.0', lspDirectoryPath: 'C:\\y' };
  assert.throws(() => retargetCodefulProject(projectPath, candidate), /Could not find a <PackageReference/);
});

test('retargetCodefulProject throws when nuget.config has no recognizable packageSources/current entry', () => {
  const root = makeTempDir('retarget-unrecognized-nuget-');
  const projectPath = path.join(root, 'project');
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'MyLogicApp.csproj'),
    '<Project><ItemGroup><PackageReference Include="Microsoft.Azure.Workflows.Sdk" Version="1.0.0-preview.1"/></ItemGroup></Project>\n'
  );
  fs.writeFileSync(path.join(projectPath, 'nuget.config'), '<?xml version="1.0" encoding="utf-8"?>\n<configuration></configuration>\n');
  const candidate = { packageId: 'Microsoft.Azure.Workflows.Sdk', version: '1.0.0', lspDirectoryPath: 'C:\\y' };
  assert.throws(() => retargetCodefulProject(projectPath, candidate), /Could not find a packageSources/);
});

test('retargetCodefulProject throws when --project has no nuget.config', () => {
  const root = makeTempDir('retarget-missing-nuget-');
  const projectPath = path.join(root, 'project');
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'MyLogicApp.csproj'),
    '<Project><ItemGroup><PackageReference Include="Microsoft.Azure.Workflows.Sdk" Version="1.0.0-preview.1"/></ItemGroup></Project>\n'
  );
  const candidate = { packageId: 'Microsoft.Azure.Workflows.Sdk', version: '1.0.0', lspDirectoryPath: 'C:\\y' };
  assert.throws(() => retargetCodefulProject(projectPath, candidate), /No nuget\.config found/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
