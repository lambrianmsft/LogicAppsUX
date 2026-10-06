const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vscode = require('vscode');
const { replaceWithLocalHttpWorkflow } = require('./fixture');

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

exports.run = async () => {
  const root = process.env.LA_CANDIDATE_TEST_ROOT;
  const candidateRoot = process.env.LOGICAPPS_LOCAL_CANDIDATE_ROOT;
  const phase = process.env.LA_CANDIDATE_TEST_PHASE;
  assert.ok(
    root && path.isAbsolute(root) && ['bootstrap', 'pickup', 'reopen'].includes(phase),
    'Use run-candidate-e2e.js to launch this suite.'
  );
  assert.equal(candidateRoot, path.join(root, 'candidate'), 'Candidate root must be a sibling of the isolated profile.');
  const receipt = { phase, status: 'running', vscodeVersion: vscode.version, stages: [] };
  const save = () => fs.writeFileSync(path.join(root, `${phase}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  async function stage(name, action) {
    const entry = { name, status: 'running', startedUtc: new Date().toISOString() };
    receipt.stages.push(entry);
    save();
    try {
      entry.evidence = await action();
      entry.status = 'passed';
      return entry.evidence;
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.message;
      throw error;
    } finally {
      entry.completedUtc = new Date().toISOString();
      save();
    }
  }
  try {
    await stage('workspace-trust', async () => {
      if (!vscode.workspace.isTrusted) {
        receipt.blocker = 'Workspace trust requires a user decision in the isolated VS Code window. The harness will not grant trust.';
        save();
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => {
              subscription.dispose();
              reject(new Error(receipt.blocker));
            },
            Math.max(1000, Number(process.env.LA_CANDIDATE_TEST_TIMEOUT) - 15000)
          );
          const subscription = vscode.workspace.onDidGrantWorkspaceTrust(() => {
            clearTimeout(timeout);
            subscription.dispose();
            resolve();
          });
        });
      }
      return { trusted: vscode.workspace.isTrusted };
    });
    const extension = vscode.extensions.getExtension(process.env.LA_CANDIDATE_EXTENSION_ID);
    assert.ok(extension, 'Installed product extension must exist.');
    assert.ok(within(path.join(root, 'extensions'), extension.extensionPath), 'Product must be loaded from private extensions directory.');
    let api;
    let installedServerPath;
    await stage('activate-product', async () => {
      api = await extension.activate();
      assert.equal(extension.isActive, true);
      return { id: extension.id, extensionPath: extension.extensionPath, isActive: extension.isActive };
    });
    let selected;
    const manifest = JSON.parse(fs.readFileSync(process.env.LOGICAPPS_LOCAL_CANDIDATE_MANIFEST, 'utf8'));
    await stage('candidate-install', async () => {
      const command = 'azureLogicAppsStandard.inspectLocalCandidate';
      assert.ok(
        (await vscode.commands.getCommands(true)).includes(command),
        'Product must register its opt-in candidate inspection command.'
      );
      selected = await vscode.commands.executeCommand(command);
      assert.ok(selected, 'Candidate inspection must return actual installation evidence.');
      for (const key of ['bundlePath', 'sdkPath', 'dependenciesPath']) {
        assert.equal(typeof selected[key], 'string', `Product must report actual ${key}.`);
        assert.ok(within(candidateRoot, selected[key]), `${key} must stay under private candidate root.`);
        assert.ok(fs.existsSync(selected[key]), `${key} must exist.`);
      }
      assert.equal(path.resolve(selected.root), path.resolve(candidateRoot));
      assert.equal(path.resolve(selected.manifestPath), path.resolve(process.env.LOGICAPPS_LOCAL_CANDIDATE_MANIFEST));
      assert.equal(selected.bundleVersion, manifest.bundle.version);
      assert.equal(selected.sdkVersion, manifest.sdk.version);
      assert.ok(
        Array.isArray(selected.missingPlatformAssets),
        'Product must report platform-asset diagnostics separately from normal health.'
      );
      assert.equal(hash(selected.sdkPath), manifest.sdk.sha256.toLowerCase(), 'Installed SDK must be byte-identical to candidate.');
      assert.equal(
        path.resolve(selected.bundlePath),
        path.join(candidateRoot, 'bundles/Microsoft.Azure.Functions.ExtensionBundle.Workflows', manifest.bundle.version)
      );
      const evidence = {
        bundlePath: selected.bundlePath,
        bundleVersion: selected.bundleVersion,
        sdkPath: selected.sdkPath,
        sdkVersion: selected.sdkVersion,
        sdkSha256: hash(selected.sdkPath),
        dependenciesPath: selected.dependenciesPath,
        platformSupport: 'untested',
        brokerSupport: 'untested',
        missingPlatformAssets: selected.missingPlatformAssets,
      };
      if (phase === 'reopen') {
        const first = JSON.parse(fs.readFileSync(path.join(root, 'pickup.json'), 'utf8'));
        assert.equal(first.status, 'passed', 'Reopen requires successful installation.');
        assert.deepEqual(
          evidence,
          first.stages.find((entry) => entry.name === 'candidate-install').evidence,
          'Reopen must preserve candidate installation paths and bytes.'
        );
      }
      return evidence;
    });
    if (phase !== 'bootstrap')
      await stage('install-sdk-lsp', async () => {
        assert.equal(typeof api?.localCandidateSmoke, 'function', 'The opt-in smoke export must invoke actual SDK/LSP installation.');
        const installed = await api.localCandidateSmoke({ workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
        assert.equal(typeof installed?.lspServerPath, 'string', 'Installer must report its installed server path.');
        assert.equal(
          path.resolve(installed.lspServerPath),
          path.join(candidateRoot, 'dependencies/LSPServer/SdkLspServer.dll'),
          'Installer must use the candidate dependency server, not an assumed bundle DLL path.'
        );
        assert.ok(fs.statSync(installed.lspServerPath).isFile(), 'Installed server must exist.');
        installedServerPath = installed.lspServerPath;
        // This is installation evidence only. Never substitute it for the post-start selection below.
        return { installedServerPath: installed.lspServerPath, installedServerSha256: hash(installed.lspServerPath) };
      });
    if (phase === 'pickup') {
      const command = 'azureLogicAppsStandard.createLocalCandidateWorkspace';
      if (!(await vscode.commands.getCommands(true)).includes(command)) {
        receipt.stages.push({
          name: 'create-workspace',
          status: 'not-run',
          reason:
            'Bounded real creation adapter unavailable. Reopen will still check installation persistence; LSP startup cannot pass without a real fixture.',
        });
        save();
      } else
        await stage('create-workspace', async () => {
          const fixture = await vscode.commands.executeCommand(command, {
            parentPath: path.join(candidateRoot, 'workspace'),
            workspaceName: 'CandidateWorkspace',
            logicAppName: 'CandidateApp',
            workflowName: 'CandidateWorkflow',
          });
          for (const key of ['workspaceFile', 'projectPath']) {
            assert.equal(typeof fixture?.[key], 'string', `Create command must return ${key}.`);
            assert.ok(path.isAbsolute(fixture[key]) && within(candidateRoot, fixture[key]), `${key} must be private.`);
            assert.ok(fs.existsSync(fixture[key]), `${key} must exist after real creation.`);
          }
          assert.ok(fixture.workspaceFile.endsWith('.code-workspace'));
          assert.ok(fs.existsSync(path.join(fixture.projectPath, 'Program.cs')), 'Real codeful project must contain Program.cs.');
          assert.ok(fs.existsSync(path.join(fixture.projectPath, 'host.json')), 'Real project must contain host.json.');
          const localSettings = JSON.parse(fs.readFileSync(path.join(fixture.projectPath, 'local.settings.json'), 'utf8'));
          assert.equal(localSettings.Values?.WORKFLOWS_SUBSCRIPTION_ID, '', 'Fixture must explicitly disable subscription metadata.');
          fixture.testOnlyWorkflowReplacement = replaceWithLocalHttpWorkflow(fixture.projectPath, candidateRoot);
          fs.writeFileSync(path.join(root, 'fixture.json'), `${JSON.stringify(fixture, null, 2)}\n`);
          return fixture;
        });
    } else if (phase === 'reopen')
      await stage('lsp-selection', async () => {
        // Opening the real generated source gives normal activation/document selectors a chance to start LSP.
        assert.ok(
          fs.existsSync(path.join(root, 'fixture.json')),
          'LSP startup not exercised: no real generated workspace fixture; installation paths alone are insufficient.'
        );
        const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'), 'utf8'));
        const document = await vscode.workspace.openTextDocument(path.join(fixture.projectPath, 'Program.cs'));
        await vscode.window.showTextDocument(document, { preview: false });
        const deadline = Date.now() + Math.max(1000, Number(process.env.LA_CANDIDATE_TEST_TIMEOUT) - 15000);
        do {
          selected = await vscode.commands.executeCommand('azureLogicAppsStandard.inspectLocalCandidate');
          if (selected?.lspSdkPath) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        } while (Date.now() < deadline);
        for (const key of ['lspSdkPath']) {
          assert.equal(
            typeof selected[key],
            'string',
            `Product must report actual ${key}; installed files alone do not prove LSP selection.`
          );
          assert.ok(within(candidateRoot, selected[key]), `${key} must stay under private candidate root.`);
          assert.ok(fs.statSync(selected[key]).isFile(), `${key} must be an actual file.`);
        }
        assert.equal(hash(selected.lspSdkPath), manifest.sdk.sha256.toLowerCase(), 'LSP must select the candidate SDK bytes.');
        const evidence = {
          lspSdkPath: selected.lspSdkPath,
          lspServerPath: installedServerPath,
          serverEvidence: 'Installed dependency path reported by product smoke; process path is not independently observed.',
          sdkSha256: hash(selected.lspSdkPath),
          lspSha256: hash(installedServerPath),
        };
        return evidence;
      });
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed';
    receipt.error = error.stack || error.message;
    throw error;
  } finally {
    receipt.completedUtc = new Date().toISOString();
    save();
  }
};
