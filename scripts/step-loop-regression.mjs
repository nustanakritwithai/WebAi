import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app-core.js', import.meta.url), 'utf8');
function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `real executor source is available: ${startMarker}`);
  return source.slice(start, end);
}
const executorSource = [
  extract('const BROWSER_STEP_STATUSES', 'function buildBrowserTaskHandoff'),
  extract('function isRecoverableArtifactError', 'function browserAgentPlanDocument'),
  extract('async function executeBrowserPlanSteps', 'async function generateAndSaveBrowserDemo'),
].join('\n');
const folder = 'tasks/BROWSER-12345678';
const jsonClone = value => JSON.parse(JSON.stringify(value));

function createTask(multiFile = false) {
  const names = multiFile ? ['app.js', 'style.css'] : ['app.js'];
  return {
    id: 'BROWSER-12345678', workspaceFolder: folder, planVersion: 1,
    plan: { steps: [
      { id: 'one', title: 'first', targetFiles: names, dependencies: [] },
      { id: 'two', title: 'extend', targetFiles: ['app.js'], dependencies: ['one'] },
    ] },
    steps: [], artifactManifest: names.map(name => ({ name, kind: name.endsWith('.css') ? 'css' : 'javascript' })),
    artifactProgress: { pending: [...names], saved: [] }, fileCheckpoints: {},
  };
}

function createHarness({ records = {}, failRequest = 0 } = {}) {
  const events = [];
  const requests = [];
  const writes = [];
  const tokenError = Object.assign(new Error('Response interrupted'), { code: 'token_limit' });
  const context = vm.createContext({
    console, TextEncoder, ARTIFACT_FILE_NAME: /^[\w.-]+$/,
    BROWSER_ARTIFACT_MANIFEST: [{ name: 'app.js' }],
    planText: JSON.stringify, browserPlanSummary: () => '', utf8Bytes: s => Buffer.byteLength(s),
    saveBrowserAgentTask() {}, applyAgentTask() {}, addTimeline() {},
    addBrowserAgentEvent(type, message) {
      events.push({ type, message });
      assert.ok(events.length <= 32, 'executor must terminate within the event budget');
    },
    isCurrentGeneration: () => true,
    artifactKindForName: () => 'javascript', CONTINUE_HANDOFF_INSTRUCTION: 'continue',
    buildBrowserTaskHandoff: () => ({}), boundedUtf8: s => s, AGENT_MODEL_CONTEXT_MAX_FILE_BYTES: 12000,
    requestBrowserAgentChat: async messages => {
      const target = messages[1].content.match(/\nTarget: ([^\n]+)/)?.[1];
      const stepId = messages[1].content.match(/\nNext unfinished step id: ([^\n]+)/)?.[1];
      assert.ok(target && stepId, 'request identifies its file and step');
      requests.push({ target, stepId, messages });
      assert.ok(requests.length <= 16, 'executor must terminate within the request budget');
      if (requests.length === failRequest) throw tokenError;
      return `/* ${stepId}: ${target}; request ${requests.length} */`;
    },
    typhoonAnswer: s => s, artifactFileContent: s => s,
  });
  vm.runInContext(executorSource, context);
  const workspace = {
    taskFolderForId: () => folder,
    async readTaskFiles(id, names) {
      return Object.fromEntries(names.map(name => {
        const path = `${folder}/${name}`;
        if (!records[path]) throw new Error('Workspace file not found: ' + path);
        return [path, jsonClone(records[path])];
      }));
    },
    async writeTaskFiles(id, files) {
      return files.map(file => {
        const path = `${folder}/${file.name}`;
        const before = records[path];
        assert.equal(file.expectedRevision, before?.version || 0, `revision precondition for ${file.name}`);
        if (before) assert.equal(file.expectedHash, before.hash, `hash precondition for ${file.name}`);
        const version = (before?.version || 0) + 1;
        const hash = createHash('sha256').update(file.content).digest('hex');
        records[path] = { path, version, content: file.content, hash };
        writes.push({ name: file.name, version });
        return { path, version, hash };
      });
    },
  };
  return {
    context, records, events, requests, writes, tokenError,
    run: (task, generation = 'run') => context.executeBrowserPlanSteps(workspace, task, generation),
    persisted: () => JSON.parse(records[`${folder}/TASK.json`].content),
  };
}

const eventTypes = harness => harness.events.map(event => event.type);
const requestTargets = harness => harness.requests.map(({ stepId, target }) => `${stepId}/${target}`);

function assertCompleted(harness, task) {
  assert.equal(task.steps.map(step => step.status).join(','), 'done,done');
  assert.equal(task.nextStepId, null);
  assert.deepEqual(Array.from(task.artifactProgress.pending), []);
  for (const step of task.steps) {
    assert.equal(harness.context.browserStepEvidenceIsValid(step), true, `${step.id} has durable evidence`);
  }
  assert.deepEqual(harness.persisted().steps, jsonClone(task.steps));
  assert.equal(harness.persisted().nextStepId, null);
}

test('real executor: shared-file next step completes once and survives JSON reload', async () => {
  const harness = createHarness();
  const task = createTask();
  await harness.run(task);
  assert.deepEqual(requestTargets(harness), ['one/app.js', 'two/app.js']);
  assert.deepEqual(eventTypes(harness), [
    'step_started', 'file_saved', 'step_completed',
    'step_started', 'file_saved', 'step_completed',
  ]);
  assertCompleted(harness, task);
  assert.equal(task.steps[0].evidence.readback.files['app.js'].revision, 1);
  assert.equal(task.steps[1].evidence.readback.files['app.js'].revision, 2);
  assert.equal(harness.records[`${folder}/app.js`].version, 2);

  const beforeEvents = harness.events.length;
  await harness.run(task, 'completed-resume');
  assert.equal(harness.requests.length, 2, 'completed run must not regenerate');
  assert.equal(harness.events.length, beforeEvents, 'completed resume emits no lifecycle events');

  const reloaded = jsonClone(task);
  const fresh = createHarness({ records: jsonClone(harness.records) });
  await fresh.run(reloaded, 'reloaded-resume');
  assertCompleted(fresh, reloaded);
  assert.equal(fresh.requests.length, 0);
  assert.deepEqual(fresh.events, []);
  assert.equal(fresh.records[`${folder}/app.js`].version, 2);
});

for (const reload of [false, true]) {
  test(`real executor: token-limit mid multi-file step resumes ${reload ? 'after JSON reload' : 'in memory'}`, async () => {
    let harness = createHarness({ failRequest: 2 });
    let task = createTask(true);
    await assert.rejects(harness.run(task), error => error === harness.tokenError);
    assert.deepEqual(requestTargets(harness), ['one/app.js', 'one/style.css']);
    assert.deepEqual(eventTypes(harness), ['step_started', 'file_saved', 'step_failed']);
    assert.equal(task.steps.map(step => step.status).join(','), 'running,pending');
    assert.equal(task.nextStepId, 'one');
    assert.equal(task.checkpoint.phase, 'error');
    assert.equal(task.checkpoint.stepId, 'one');
    assert.equal(task.steps[0].evidence, null, 'partial step must not claim completion');
    assert.deepEqual(Array.from(task.artifactProgress.saved), ['app.js']);
    assert.deepEqual(Array.from(task.artifactProgress.pending), ['style.css']);
    const firstRecord = jsonClone(harness.records[`${folder}/app.js`]);
    assert.equal(firstRecord.version, 1);
    assert.equal(harness.records[`${folder}/style.css`], undefined);
    assert.equal(task.fileCheckpoints['app.js'].stepId, 'one');
    assert.equal(task.fileCheckpoints['app.js'].revision, firstRecord.version);
    assert.equal(task.fileCheckpoints['app.js'].hash, firstRecord.hash);
    const persisted = harness.persisted();
    for (const key of ['steps', 'nextStepId', 'checkpoint', 'fileCheckpoints', 'artifactProgress']) {
      assert.deepEqual(persisted[key], jsonClone(task[key]), `${key} survives checkpoint persistence`);
    }

    if (reload) {
      // Browser task storage retains the plan/manifest; TASK.json supplies the durable executor state.
      const originalStep = task.steps[0];
      task = { ...jsonClone(task), ...persisted };
      assert.notEqual(task.steps[0], originalStep, 'reload discards live step identity');
      harness = createHarness({ records: jsonClone(harness.records) });
    }
    const requestStart = harness.requests.length;
    const eventStart = harness.events.length;
    const writeStart = harness.writes.length;
    await harness.run(task, 'resume');
    assert.deepEqual(requestTargets(harness).slice(requestStart), ['one/style.css', 'two/app.js']);
    assert.deepEqual(eventTypes(harness).slice(eventStart), [
      'step_started', 'file_skipped', 'file_saved', 'step_completed',
      'step_started', 'file_saved', 'step_completed',
    ]);
    assert.deepEqual(harness.writes.slice(writeStart).filter(write => ['app.js', 'style.css'].includes(write.name)), [
      { name: 'style.css', version: 1 }, { name: 'app.js', version: 2 },
    ], 'resume reuses the saved first file, but the dependent step writes its own revision');
    assertCompleted(harness, task);
    assert.equal(task.steps[0].evidence.readback.files['app.js'].hash, firstRecord.hash);
    assert.equal(task.steps[0].evidence.readback.files['app.js'].revision, 1);
    assert.equal(task.steps[0].evidence.readback.files['style.css'].revision, 1);
    assert.equal(task.steps[1].evidence.readback.files['app.js'].revision, 2);
    assert.equal(task.fileCheckpoints['app.js'].stepId, 'two');
    assert.ok(harness.requests.at(-1).messages[1].content.includes(firstRecord.content), 'next step receives saved file context');
    const finishedRequests = harness.requests.length;
    const finishedEvents = harness.events.length;
    await harness.run(task, 'resume-again');
    assert.equal(harness.requests.length, finishedRequests);
    assert.equal(harness.events.length, finishedEvents, 'no repeated start/completed events');
  });
}

test('real executor: removed provisional targets reconcile to real manifest files', async () => {
  const harness = createHarness();
  const task = createTask();
  task.planVersion = 2;
  harness.context.ensureBrowserPlanSteps(task);
  task.steps[0].targetFiles = ['removed.js'];
  await harness.run(task);
  assert.deepEqual(Array.from(task.steps[0].targetFiles), ['app.js']);
  assert.deepEqual(requestTargets(harness), ['one/app.js', 'two/app.js']);
  assert.deepEqual(eventTypes(harness), [
    'step_started', 'file_saved', 'step_completed',
    'step_started', 'file_saved', 'step_completed',
  ]);
  assertCompleted(harness, task);
});

test('real executor: empty targets terminate without false completion events', async () => {
  const harness = createHarness();
  const task = createTask();
  harness.context.ensureBrowserPlanSteps(task);
  // Retain a normalized step with no targets and no manifest fallback available.
  task.steps[0].targetFiles = [];
  task.artifactManifest = [];
  harness.context.reconcileBrowserPlanTargets(task);
  assert.equal(task.steps[0].targetFiles.length, 0, 'exercise actual empty executor targets, not inference fallback');
  await assert.rejects(harness.run(task), /(?:empty|no target|incomplete)/i);
  assert.equal(harness.requests.length, 0, 'dependent work must not start');
  assert.deepEqual(eventTypes(harness), ['step_started', 'step_failed'], 'empty target step must not loop or claim completion');
  assert.equal(harness.persisted().steps[0].status, 'failed');
  assert.equal(harness.persisted().steps[1].status, 'pending');
  assert.equal(harness.persisted().nextStepId, 'one');
  assert.equal(harness.persisted().checkpoint.phase, 'error');
  const reloaded = jsonClone(task);
  const fresh = createHarness({ records: jsonClone(harness.records) });
  await assert.rejects(fresh.run(reloaded, 'retry-empty'), /(?:empty|no target|incomplete)/i);
  assert.deepEqual(eventTypes(fresh), ['step_started', 'step_failed']);
  assert.equal(fresh.requests.length, 0);
});
