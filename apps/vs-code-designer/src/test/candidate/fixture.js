const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const digest = (content) => crypto.createHash('sha256').update(content).digest('hex');

// Only replace the generated sample provider in the disposable fixture. Project files, SDK
// references, host configuration and tasks remain exactly as the real generators produced them.
function replaceWithLocalHttpWorkflow(projectPath, candidateRoot) {
  const relative = path.relative(candidateRoot, projectPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Fixture project must be inside candidate ROOT.');
  const physicalRelative = path.relative(fs.realpathSync(candidateRoot), fs.realpathSync(projectPath));
  if (!physicalRelative || physicalRelative.startsWith('..') || path.isAbsolute(physicalRelative))
    throw new Error('Fixture project resolves outside candidate ROOT.');
  const file = path.join(projectPath, 'CandidateWorkflow.cs');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Fixture provider must not be a symlink.');
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes('IWorkflowProvider'))
    throw new Error('Expected an actual generated workflow provider before fixture replacement.');
  const source = `// Test-only replacement of the generated managed-connector sample.
namespace CandidateApp
{
    using Microsoft.Azure.Workflows.Sdk;

    public class CandidateWorkflow : IWorkflowProvider
    {
        public FlowDefinition[] GetWorkflows()
        {
            var trigger = WorkflowTriggers.BuiltIn.CreateHttpTrigger();
            var response = WorkflowActions.BuiltIn.Response(responseBody: () => "local-candidate-ok");
            var workflow = trigger.Then(response);
            return new[] { WorkflowFactory.CreateStatefulWorkflow("CandidateWorkflow", workflow) };
        }
    }
}
`;
  fs.writeFileSync(file, source);
  return {
    path: file,
    beforeSha256: digest(original),
    afterSha256: digest(source),
    provider: 'built-in-http-response',
    expectedBody: 'local-candidate-ok',
  };
}

module.exports = { replaceWithLocalHttpWorkflow };
