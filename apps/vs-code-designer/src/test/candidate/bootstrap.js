// Executes the compiled product installer in a child with the harness's isolated environment.
// This is not a mock and does not implement extraction or ownership rules.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function main() {
  const envelope = process.env.LA_CANDIDATE_TEST_ROOT;
  const candidateRoot = process.env.LOGICAPPS_LOCAL_CANDIDATE_ROOT;
  const modulePath = process.argv[2];
  if (!envelope || candidateRoot !== path.join(envelope, 'candidate') || !path.isAbsolute(modulePath || '')) {
    throw new Error('Run bootstrap only through run-candidate-e2e.js with an isolated candidate root.');
  }
  const receipt = { status: 'running', kind: 'compiled-product-installer', modulePath };
  try {
    if (fs.existsSync(candidateRoot)) throw new Error('Candidate root must be absent before product bootstrap.');
    const product = require(modulePath);
    if (typeof product.ensureLocalCandidateInstalled !== 'function') throw new Error('Compiled product installer export is missing.');
    const installed = await product.ensureLocalCandidateInstalled();
    if (!installed || path.resolve(installed.root) !== path.resolve(candidateRoot))
      throw new Error('Product installer returned the wrong root.');
    receipt.evidence = {
      root: installed.root,
      bundlePath: installed.bundlePath,
      sdkPath: installed.sdkPath,
      ...(Array.isArray(installed.missingPlatformAssets) ? { missingPlatformAssets: installed.missingPlatformAssets } : {}),
      platformSupport: 'untested',
      brokerSupport: 'untested',
      moduleSha256: crypto.createHash('sha256').update(fs.readFileSync(modulePath)).digest('hex'),
    };
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed';
    receipt.error = error.stack || error.message;
    throw error;
  } finally {
    fs.writeFileSync(path.join(envelope, 'bootstrap.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
