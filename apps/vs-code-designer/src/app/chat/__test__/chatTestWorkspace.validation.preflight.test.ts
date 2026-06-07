import * as path from 'path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const testWorkspaceRoot = path.join(process.cwd(), 'e2e', 'test-workspace');
let existsSync: typeof import('fs').existsSync;

beforeAll(async () => {
  ({ existsSync } = await vi.importActual<typeof import('fs')>('fs'));
});

describe('chat test workspace topology preflight contracts', () => {
  it('does not include the legacy root Workflows container', () => {
    expect(existsSync(path.join(testWorkspaceRoot, 'Workflows'))).toBe(false);
  });

  it('keeps the baseline workflow directly under the Logic App project root', () => {
    expect(existsSync(path.join(testWorkspaceRoot, 'host.json'))).toBe(true);
    expect(existsSync(path.join(testWorkspaceRoot, 'Stateful1', 'workflow.json'))).toBe(true);
  });
});
