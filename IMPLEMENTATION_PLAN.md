# WebAi — Implementation Plan

> เป้าหมาย: สร้าง **AI Software Engineering CPU** ที่รับคำสั่งจากผู้ใช้ผ่านเว็บ แล้ววางแผน เขียนโค้ด ทดสอบ ตรวจหลักฐาน จำประสบการณ์ และประสานงานหลาย agent โดยใช้โมเดลเล็กเป็นค่าเริ่มต้น และ escalate เฉพาะเมื่อจำเป็น

Baseline date: 2026-09-06

---

## 1. Product Goal

WebAi ต้องทำให้วงจรนี้เกิดขึ้นจริง:

```text
มือถือ / Browser
    ↓
Web UI
    ↓
AI CPU / Task Engine
    ↓
OMP coding worker
    ↓
Repository / Workspace
    ↓
Build + Test + Preview
    ↓
Verification Gate
    ↓
Git / PR / Deploy
```

จากนั้นค่อยเพิ่ม intelligence รอบแกนหลัก:

```text
ECC       = KNOW HOW
OMP       = DO
Hermes    = REMEMBER
OpenClaw  = COMMUNICATE
Harpoon   = MEASURE
Tests     = VERIFY
Git       = HISTORY
Database  = STATE
AI CPU    = CONTROL
```

---

## 2. Non-negotiable Architecture Rules

1. **AI CPU เป็น Control Plane กลาง** — task state, routing, permission, retry, context budget อยู่ที่นี่
2. **Git เป็น source of truth ของ code**
3. **Database เป็น source of truth ของ task/state/evidence**
4. **Hermes เป็น agent memory ไม่ใช่ฐานข้อมูลหลัก**
5. **OpenClaw เป็น agent/session communication ไม่ใช่ low-level event bus**
6. **Harpoon เป็น performance evidence ไม่ใช่ verifier เพียงตัวเดียว**
7. **OMP/LLM ไม่มีสิทธิ์ประกาศ DONE ด้วยการประเมินตัวเอง**
8. ทุกงานสำคัญต้องมี reproducible evidence และ regression เมื่อเหมาะสม
9. เริ่มจากโมเดลเล็กก่อน และ escalate เมื่อมีเหตุผลเชิงคุณภาพ/ความเสี่ยง/ความซับซ้อน
10. แต่ละ integration ต้องถอดออกได้โดยไม่ทำลาย core task engine

---

## 3. Suggested Core Stack

เลือก stack จริงได้ภายหลัง แต่ baseline แนะนำ:

- Frontend: React/Next.js หรือ Vite + React
- Backend: Node.js + TypeScript
- Realtime: WebSocket / Server-Sent Events
- Database: PostgreSQL (หรือ SQLite สำหรับ local prototype)
- Queue: เริ่ม in-process queue ก่อน; เพิ่ม Redis/BullMQ เมื่อมี concurrent jobs จริง
- Workspace: isolated directory ต่อ task/project
- Process runner: child process wrapper + timeout + kill + stdout/stderr capture
- Git: local git + GitHub integration
- Preview: isolated dev server ต่อ workspace พร้อม port allocation
- Secrets: server-side env/secret store; ห้ามส่ง secret ลง client

---

# 4. Development Roadmap

## V0.1 — Foundation Loop

### เป้าหมาย
สร้างวงจรขั้นต่ำที่ใช้งานได้จริงจากมือถือ:

```text
User task → API → OMP → edit repo → build/test → live preview → result
```

### ต้องมี

- Project list
- Task creation
- Chat/task command box
- Backend API connection (ผู้ใช้มี API แล้ว)
- Task ID + task state
- Workspace per task
- OMP session bridge
- Repository read/edit
- Command execution
- Build runner
- Test runner
- Live preview
- Changed-files viewer
- stdout/stderr log viewer
- Git diff
- manual Commit/PR gate

### Task states

```text
CREATED
ANALYZING
PLANNED
RUNNING
BUILDING
TESTING
PREVIEWING
VERIFYING
READY_FOR_REVIEW
FAILED
CANCELLED
DONE
```

### Acceptance V0.1

TASK-001:

> “เพิ่มหน้า Login ตัวอย่าง”

ต้องสามารถ:

1. สร้าง task
2. ให้ OMP อ่าน repo
3. แก้ไฟล์จริง
4. build ผ่าน
5. test ผ่าน
6. เปิด preview
7. แสดง diff
8. แสดง log
9. เก็บ evidence
10. ห้าม commit โดยอัตโนมัติถ้ายังไม่ผ่าน gate

### Metrics baseline

เก็บตั้งแต่ V0.1 แม้ยังไม่มีระบบฉลาด:

- task success rate
- first-pass success rate
- build failure rate
- test failure rate
- average retries
- tokens/request
- API cost/task
- task latency
- files changed/task
- rollback rate

---

## V0.2 — AI CPU / Task Engine

### เป้าหมาย
แยก orchestration ออกจาก UI และ OMP อย่างชัดเจน

### Components

- Task State Machine
- Model Router
- Context Builder
- Permission Engine
- Retry Policy
- Escalation Policy
- Cancellation
- Timeout handling
- Structured Event Bus
- Artifact Registry
- Evidence Registry

### Structured task contract

```json
{
  "taskId": "TASK-001",
  "projectId": "webai",
  "goal": "Add login page",
  "constraints": [],
  "acceptance": [],
  "risk": "medium",
  "status": "PLANNED"
}
```

### Event examples

```text
TASK_CREATED
PLAN_READY
WORKER_STARTED
FILE_CHANGED
BUILD_STARTED
BUILD_FINISHED
TEST_FINISHED
PREVIEW_READY
VERIFICATION_FAILED
VERIFICATION_PASSED
TASK_ESCALATED
TASK_DONE
```

Low-level events อยู่ backend; ส่งเข้า LLM เฉพาะเมื่อมีผลต่อการตัดสินใจ

---

## V0.3 — ECC Engineering Layer

### เป้าหมาย
ใช้ ECC เป็น know-how และ workflow layer โดยไม่บังคับให้ OMP รับ context ทั้งชุดทุกครั้ง

### Pipeline

```text
Task
 ↓
Capability selection
 ↓
Relevant ECC rules/skills
 ↓
Plan + Acceptance + Risks
 ↓
OMP
```

### ต้องทำ

- ECC capability registry
- Rule/skill selector
- Context size budget
- Compatibility tests กับ OMP
- Security checklist
- Review checklist
- Plan template
- Acceptance template

### กฎ

- ไม่โหลด ECC ทุก skill เข้า context
- เลือกเฉพาะสิ่งที่เกี่ยวกับ task
- ทุก rule/skill ที่ใช้ต้อง trace กลับได้ว่าเลือกเพราะอะไร

---

## V0.4 — Verification Gate

### Definition of Done

งานสำคัญต้องผ่าน gate ที่เกี่ยวข้อง:

```text
Build              PASS
Unit Tests         PASS
Integration Tests  PASS
Browser Test       PASS
ECC Review         PASS
Security Check     PASS
Regression         PASS
Harpoon            PASS (เมื่อเปิดใช้ V0.5)
```

### Evidence record

ทุก check ต้องบันทึก:

- verifier
- command/tool
- timestamp
- input/ref
- output summary
- pass/fail
- artifact/log pointer
- commit SHA / workspace revision

### หลักสำคัญ

```text
LLM says “done” ≠ DONE
Evidence Gate PASS = READY
```

---

## V0.5 — Harpoon Performance Layer

### เป้าหมาย
วัดเว็บที่รันจริงและเก็บผลก่อน/หลัง

### Flow

```text
Baseline preview
 ↓
Harpoon analyze
 ↓
OMP change
 ↓
New preview
 ↓
Harpoon analyze
 ↓
Compare
 ↓
Evidence
```

### Metrics

- performance score
- requests
- JS/CSS payload
- loading metrics ที่ Harpoon ให้ได้
- regression threshold
- before/after delta

### Policy

Performance optimization task ต้องมี baseline ก่อนแก้เสมอ

---

## V0.6 — Hermes Memory

### Memory classes

1. Working Memory
2. Project Memory
3. Decision Memory
4. Failure / Root Cause Memory
5. Regression Memory
6. Skill Memory
7. Evidence Summary

### Memory Gate

```text
Event / Result
 ↓
Worth remembering?
 ↓
Deduplicate
 ↓
Summarize
 ↓
Attach evidence
 ↓
Store
```

### ห้าม

- จำทุก chat message
- ใช้ memory แทน DB
- จำข้อสรุปที่ยังไม่มีหลักฐานเป็น fact ถาวร

### Retrieval

ส่งให้โมเดลเฉพาะ memory ที่เกี่ยวข้องกับ task ปัจจุบัน และจำกัดตาม context budget

---

## V0.7 — OpenClaw Multi-Agent Communication

### เป้าหมาย
รองรับ multi-agent workflow โดยไม่ทำให้ทุก event ผ่าน LLM

### ตัวอย่าง topology

```text
Planner
  ↓
Coder (OMP)
  ↓
Reviewer
  ↓
Tester
  ↓
AI CPU
```

### OpenClaw รับผิดชอบ

- agent/session routing
- handoff
- steering
- cancellation
- agent-to-agent structured messages

### Backend Event Bus รับผิดชอบ

- file_changed
- process_started
- build logs
- test logs
- CPU/process status
- raw metric events

---

## V0.8 — Learning Loop

### Loop

```text
Task
 ↓
Attempt
 ↓
Failure
 ↓
Root Cause
 ↓
Fix
 ↓
Evidence PASS
 ↓
Regression Test
 ↓
Reusable Skill
 ↓
Memory
```

### Learning artifact

```json
{
  "problemClass": "auth.refresh.expiry",
  "rootCause": "missing token rotation",
  "solution": "rotate before expiry",
  "evidence": ["AUTH-017"],
  "regression": "auth-refresh-expiry.spec.ts",
  "reuseCount": 0
}
```

### สิ่งที่ต้องวัด

- repeat-failure rate ลดลงหรือไม่
- task success หลัง retrieval สูงขึ้นหรือไม่
- retries ลดลงหรือไม่
- token/cost ลดลงหรือไม่

---

## V0.9 — Smart Model Routing

### Policy baseline

```text
Small model first
    ↓
Confidence / validation / failure
    ↓
Need escalation?
 ├─ No → continue
 └─ Yes → stronger model
```

### Routing signals

- task complexity
- number of files/modules
- risk level
- repeated failure count
- test failure type
- architecture/security involvement
- context size
- cost budget

### Metrics

- cost per successful task
- escalation rate
- unnecessary escalation rate
- quality after escalation
- latency

---

## V1.0 — Measured Agent System

V1.0 ต้องพิสูจน์ว่า environment รอบโมเดลทำให้ agent เก่งขึ้นจริง ไม่ใช่แค่รู้สึกว่าดีขึ้น

### Benchmark design

อย่างน้อย 3 configurations:

```text
A. API Model + basic prompt
B. API Model + OMP
C. Full WebAi stack
```

อาจเพิ่ม ablation:

```text
C - ECC
C - Hermes
C - Harpoon
C - OpenClaw
C - Smart Routing
```

### Held-out task groups

- simple frontend edit
- multi-file feature
- bug fix
- regression fix
- performance optimization
- security-sensitive change
- repository comprehension
- refactor

### V1.0 report

ต้องมี:

- baseline
- benchmark protocol
- held-out tasks
- pass rate
- first-pass pass rate
- regression rate
- cost/task
- latency/task
- token usage
- escalation rate
- memory retrieval benefit
- before/after comparison

---

# 5. Database Model — Initial Draft

```text
projects
project_repositories
workspaces

tasks
task_steps
task_events
task_artifacts

agent_sessions
agent_messages
model_calls

build_runs
test_runs
verification_runs
harpoon_runs

git_revisions
git_pull_requests

memories
memory_evidence
skills
skill_runs
regressions

routing_decisions
cost_records
```

---

# 6. Security / Safety Boundaries

ก่อนเปิดให้ worker แก้ repo จริง ต้องมี:

- allowlisted workspace roots
- command timeout
- process kill
- max output size
- secret redaction
- environment separation
- no raw secret in browser
- per-project permission policy
- protected branch policy
- manual approval สำหรับ destructive actions ช่วงแรก
- audit log ทุก tool action
- network policy เมื่อเริ่มรัน third-party code

---

# 7. UI Plan

หน้าแรกควรมี:

### Left rail
- Projects
- Agents
- Tools

### Main center
- Chat / Task
- Plan
- Task steps
- Changed files
- Logs
- Terminal

### Right panel
- Live Preview
- Verification
- Harpoon metrics

### Bottom / Monitor
- Task progress
- Recent activities
- System health
- API/model usage
- cost

Mobile-first requirement:

- task command ใช้ง่ายด้วยนิ้วเดียว
- preview สลับ Desktop/Tablet/Mobile
- ไม่เปิด log ยาวทั้งหมดโดย default
- action สำคัญต้องมี confirmation UI

---

# 8. First Sprint — P0

## P0.1 Repository/Foundation

- [ ] Scaffold frontend/backend
- [ ] `.env.example`
- [ ] TypeScript strict mode
- [ ] lint/format/test scripts
- [ ] health endpoint
- [ ] project config schema

## P0.2 API Bridge

- [ ] provider interface
- [ ] API key server-side only
- [ ] model call logger
- [ ] timeout/retry
- [ ] token/cost record

## P0.3 Task Engine

- [ ] task CRUD
- [ ] state machine
- [ ] event stream
- [ ] cancellation
- [ ] persistence

## P0.4 OMP Bridge

- [ ] create session
- [ ] send instruction
- [ ] receive structured output
- [ ] stream logs
- [ ] detect changed files
- [ ] terminate session

## P0.5 Workspace + Git

- [ ] project checkout
- [ ] isolated task workspace
- [ ] git diff
- [ ] reset/rollback
- [ ] optional branch per task

## P0.6 Build/Test/Preview

- [ ] detect project commands
- [ ] run build
- [ ] run tests
- [ ] allocate preview port
- [ ] health check preview
- [ ] stop process

## P0.7 Web UI

- [ ] project page
- [ ] task composer
- [ ] task timeline
- [ ] live logs
- [ ] changed files
- [ ] live preview
- [ ] PASS/FAIL status

---

# 9. First End-to-End Acceptance Test

ชื่อ: `E2E-001 FOUNDATION LOOP`

### Given
- มี repo ตัวอย่าง
- API ใช้งานได้
- OMP bridge online

### When
ผู้ใช้สั่ง:

> เพิ่มหน้า `/hello` ที่แสดง “WebAi is running” และเพิ่ม test ให้ด้วย

### Then

- [ ] task ถูกสร้าง
- [ ] OMP แก้ไฟล์จริง
- [ ] diff ถูกแสดง
- [ ] build PASS
- [ ] test PASS
- [ ] preview เปิด `/hello` ได้
- [ ] evidence ถูกบันทึก
- [ ] UI แสดง READY_FOR_REVIEW
- [ ] rollback ได้

หากข้อใดไม่ผ่าน V0.1 ยังไม่ถือว่าสำเร็จ

---

# 10. Development Principle

> **อย่าเริ่มด้วยการต่อ ECC + OMP + Hermes + OpenClaw + Harpoon พร้อมกัน**

สร้างแกนนี้ให้ผ่านก่อน:

```text
WEB → AI CPU → OMP → REPO → BUILD/TEST → PREVIEW
```

จากนั้นเพิ่มทีละชั้น พร้อม regression test ทุกครั้ง

เป้าหมายสุดท้ายไม่ใช่ “มี agent เยอะ” แต่คือ:

> **โมเดลเล็กทำงานได้เก่งขึ้นอย่างวัดผลได้ เพราะระบบรอบตัวมี memory, routing, verification, communication, skills และ learning loop ที่ดี**
