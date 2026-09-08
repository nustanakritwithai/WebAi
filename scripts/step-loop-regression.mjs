import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app-core.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const BROWSER_STEP_STATUSES'), source.indexOf('function buildBrowserTaskHandoff'));
const executor = source.slice(source.indexOf('async function executeBrowserPlanSteps'), source.indexOf('async function generateAndSaveBrowserDemo'));
const records = {};
const events = [];
let requests = 0;
const context = vm.createContext({
  console, TextEncoder, ARTIFACT_FILE_NAME: /^[\w.-]+$/, BROWSER_ARTIFACT_MANIFEST: [{ name: 'app.js' }],
  planText: JSON.stringify, browserPlanSummary: () => '', utf8Bytes: s => Buffer.byteLength(s),
  saveBrowserAgentTask() {}, applyAgentTask() {}, addTimeline() {},
  addBrowserAgentEvent(type) { events.push(type); assert.ok(events.length < 50, 'executor must terminate'); },
  isCurrentGeneration: () => true, isRecoverableArtifactError: () => false,
  artifactKindForName: () => 'javascript', CONTINUE_HANDOFF_INSTRUCTION: 'continue',
  buildBrowserTaskHandoff: () => ({}), boundedUtf8: s => s, AGENT_MODEL_CONTEXT_MAX_FILE_BYTES: 12000,
  requestBrowserAgentChat: async () => { requests++; return 'code-' + requests; },
  typhoonAnswer: s => s, artifactFileContent: s => s,
});
vm.runInContext(helpers + '\n' + executor, context);
const workspace = {
  taskFolderForId: () => 'tasks/BROWSER-12345678',
  async readTaskFiles(id, names) {
    return Object.fromEntries(names.map(name => {
      const path = this.taskFolderForId() + '/' + name;
      if (!records[path]) throw new Error('Workspace file not found: ' + path);
      return [path, records[path]];
    }));
  },
  async writeTaskFiles(id, files) {
    return files.map(file => {
      const path = this.taskFolderForId() + '/' + file.name;
      const version = (records[path]?.version || 0) + 1;
      records[path] = { path, version, content: file.content, hash: 'a'.repeat(64) };
      return { path, version, hash: records[path].hash };
    });
  },
};
const task = {
  id: 'BROWSER-12345678', workspaceFolder: workspace.taskFolderForId(), planVersion: 1,
  plan: { steps: [
    { id: 'one', title: 'first', targetFiles: ['app.js'], dependencies: [] },
    { id: 'two', title: 'extend', targetFiles: ['app.js'], dependencies: ['one'] },
  ] },
  steps: [], artifactManifest: [{ name: 'app.js', kind: 'javascript' }],
  artifactProgress: { pending: ['app.js'], saved: [] }, fileCheckpoints: {},
};
await context.executeBrowserPlanSteps(workspace, task, 'run');
assert.equal(requests, 2, 'later step targeting same file must perform its own work');
assert.deepEqual(task.steps.map(s => s.status).join(','), 'done,done');
assert.equal(events.filter(e => e === 'step_started').length, 2);
assert.equal(events.filter(e => e === 'step_completed').length, 2);
assert.equal(task.nextStepId, null);
assert.equal(JSON.parse(records[task.workspaceFolder + '/TASK.json'].content).steps[1].status, 'done');
await context.executeBrowserPlanSteps(workspace, task, 'resume');
assert.equal(requests, 2, 'completed run must not regenerate');
console.log('PASS real executor: durable completion, same-file steps, bounded events, completed resume');
