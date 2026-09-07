const STATUS = Object.freeze({ pending: "pending", running: "running", blocked: "blocked", failed: "failed", done: "done" });

function createExecutor(plan) {
  const state = structuredClone({ plan, checkpoints: [] });

  function dependenciesDone(step) {
    return step.dependencies.every((id) => state.plan.steps.find((candidate) => candidate.id === id)?.status === STATUS.done);
  }

  function nextStep() {
    return state.plan.steps.find((step) => step.status === STATUS.pending && dependenciesDone(step)) || null;
  }

  function runNext({ succeed = true } = {}) {
    const step = nextStep();
    if (!step) return null;
    step.status = STATUS.running;
    const checkpoint = { stepId: step.id, runId: `${step.id}:1`, status: STATUS.running };
    state.checkpoints.push(checkpoint);
    if (succeed) {
      step.status = STATUS.done;
      step.evidence = { saved: true, readback: true };
      checkpoint.status = STATUS.done;
    } else {
      step.status = STATUS.failed;
      checkpoint.status = STATUS.failed;
    }
    return step.id;
  }

  return { state, nextStep, runNext };
}

const executor = createExecutor({
  planVersion: 1,
  steps: [
    { id: "design", dependencies: [], status: STATUS.pending },
    { id: "build", dependencies: ["design"], status: STATUS.pending },
    { id: "verify", dependencies: ["build"], status: STATUS.pending }
  ]
});

if (executor.nextStep()?.id !== "design") throw new Error("executor skipped the first step");
if (executor.runNext() !== "design") throw new Error("design did not run");
if (executor.nextStep()?.id !== "build") throw new Error("dependency gate did not release build");
if (executor.runNext({ succeed: false }) !== "build") throw new Error("build did not run");
if (executor.nextStep() !== null) throw new Error("failed step allowed the executor to skip ahead");
if (executor.state.checkpoints.at(-1)?.status !== STATUS.failed) throw new Error("failed checkpoint was not retained");

const build = executor.state.plan.steps.find((step) => step.id === "build");
build.status = STATUS.pending;
if (executor.nextStep()?.id !== "build") throw new Error("Continue did not resume the failed step");
if (executor.runNext() !== "build") throw new Error("repaired step did not complete");
if (executor.nextStep()?.id !== "verify") throw new Error("next step was not selected after checkpoint");
if (executor.runNext() !== "verify") throw new Error("verify did not run");
if (executor.state.plan.steps.some((step) => step.status !== STATUS.done)) throw new Error("lifecycle did not finish all steps");

console.log("PASS deterministic Step Executor lifecycle: dependency gate, failure checkpoint, Continue resume, and no skip");
