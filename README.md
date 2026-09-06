# WebAi

**AI Software Engineering CPU** — ระบบเว็บสำหรับควบคุม AI coding workflow โดยใช้ **OpenTyphoon** เป็นโมเดล/API หลัก และเพิ่มความสามารถจาก environment รอบโมเดล

## Primary Model

WebAi baseline ใช้:

```text
Provider: OpenTyphoon
Model: typhoon-v2.5-30b-a3b-instruct
Base URL: https://api.opentyphoon.ai/v1
Protocol: OpenAI-compatible Chat Completions
```

เหตุผลที่เลือก Typhoon 2.5 เป็น baseline:

- ออกแบบมาสำหรับ agentic workflow และ instruction following
- รองรับภาษาไทย/อังกฤษ เหมาะกับการสั่งงานจากผู้ใช้ภาษาไทย
- เข้าใจและสร้างโค้ดได้
- context สูงสุด 128K ตามเอกสาร OpenTyphoon
- API เป็น OpenAI-compatible ทำให้ provider bridge เรียบง่าย

> API key ต้องอยู่ฝั่ง server เท่านั้น ห้าม commit key ลง repository หรือส่งลง browser

เอกสารทางการ: https://docs.opentyphoon.ai/

## Vision

```text
OpenTyphoon = THINK / PRIMARY MODEL
AI CPU      = CONTROL
ECC         = KNOW HOW
OMP         = DO
OpenClaw    = COMMUNICATE
Hermes      = REMEMBER
Harpoon     = MEASURE
Tests       = VERIFY
Git         = HISTORY
Database    = STATE
```

เป้าหมายคือสร้างระบบที่รับคำสั่งจากผู้ใช้ผ่านมือถือ/เว็บ แล้วสามารถ:

1. วิเคราะห์งานด้วย OpenTyphoon
2. วางแผนและสร้าง structured task
3. ใช้ OMP แก้ repository จริง
4. build/test
5. เปิด live preview
6. ตรวจ verification gate
7. วัด performance
8. เก็บ evidence
9. เรียนรู้จาก failure/regression
10. ใช้ routing/escalation ภายหลังโดยไม่ผูก core กับ provider เดียว

## Architecture

```text
User / Mobile
     ↓
Web UI
     ↓
AI CPU / Task Engine
     │
     ├── OpenTyphoon — reasoning / planning / decisions
     ├── ECC         — engineering rules & skills
     ├── OMP         — coding worker
     ├── Hermes      — memory
     ├── OpenClaw    — agent communication
     └── Harpoon     — performance measurement
     ↓
Repository / Workspace
     ↓
Build + Tests + Preview
     ↓
Verification Gate
     ↓
Git / PR / Deploy
```

## Current Status

**Planning / Foundation — V0.1**

- `index.html` — หน้า Architecture + Roadmap
- `IMPLEMENTATION_PLAN.md` — แผนพัฒนาเต็ม V0.1 → V1.0
- `.env.example` — ตัวอย่างการตั้งค่า OpenTyphoon โดยไม่เก็บ secret
- `.github/workflows/pages.yml` — GitHub Pages deployment workflow

## Supervised Agent API

Backend agent work is supervised and stateful. Creating a task only asks OpenTyphoon for a structured plan; it never runs OMP. A separate approval request is required before execution, and the task cannot become `completed` until the backend runs the fixed verification command (`npm test`) successfully.

Endpoints:

- `POST /api/tasks` with `{ "goal": "..." }` → creates a task in `awaiting_approval`
- `GET /api/tasks` and `GET /api/tasks/:id` → reads persistent task state
- `POST /api/tasks/:id/approve` → approves the saved plan and runs OMP
- `POST /api/tasks/:id/verify` → runs verification and records evidence

The same endpoints are available under `/api/agent/tasks`. Set `AGENT_STATE_PATH` to a server-only writable location. Keep `WEB_AUTH_TOKEN` configured when the backend is reachable beyond a trusted local machine; browser clients never provide provider credentials or execution commands.

## Roadmap

| Version | Goal |
|---|---|
| V0.1 | Web + OpenTyphoon API + OMP + Git + Build/Test + Live Preview |
| V0.2 | AI CPU / Task Engine + structured model calls |
| V0.3 | ECC rules/skills integration |
| V0.4 | Verification Gate |
| V0.5 | Harpoon performance evidence |
| V0.6 | Hermes memory |
| V0.7 | OpenClaw multi-agent communication |
| V0.8 | Regression + Learning Loop |
| V0.9 | Smart model routing / cost control |
| V1.0 | Held-out benchmark + measurable improvement report |

## V0.1 Primary Flow

```text
User
 ↓
Web UI
 ↓
OpenTyphoon API
 ↓
AI CPU creates structured task
 ↓
OMP
 ↓
Repository
 ↓
Build + Tests
 ↓
Live Preview
 ↓
READY_FOR_REVIEW
```

### First acceptance task

`E2E-001 FOUNDATION LOOP`

> เพิ่มหน้า `/hello` ที่แสดง “WebAi is running” และเพิ่ม test ให้ด้วย

V0.1 ผ่านเมื่อระบบ:

- รับคำสั่งจากเว็บ
- เรียก OpenTyphoon ผ่าน backend สำเร็จ
- สร้าง task/plan แบบ structured
- ให้ OMP แก้ไฟล์จริง
- แสดง diff
- build/test ผ่าน
- เปิด preview ได้
- เก็บ evidence
- rollback ได้

## Provider Boundary

แม้ OpenTyphoon เป็นโมเดลหลัก แต่ core ห้ามเรียก SDK โดยตรงจากทุก module ให้ผ่าน interface กลางเสมอ:

```text
AI CPU
  ↓
ModelProvider
  ↓
TyphoonProvider
  ↓
https://api.opentyphoon.ai/v1
```

เพื่อให้ V0.9 สามารถเพิ่ม model routing/fallback ได้โดยไม่รื้อ Task Engine

## Definition of Done

LLM/OMP ห้ามประกาศว่า DONE จากการประเมินของตัวเองเพียงอย่างเดียว

```text
Build              PASS
Unit Tests         PASS
Integration Tests  PASS
Browser Test       PASS
ECC Review         PASS
Security Check     PASS
Harpoon            PASS (เมื่อเปิดใช้)
Regression         PASS
```

## Architecture Rules

- OpenTyphoon = primary reasoning model แต่ไม่เป็นเจ้าของ system state
- AI CPU = control plane และ routing authority
- OMP = coding worker หลัก
- ECC = engineering knowledge/workflow
- Git = source of truth ของ source code
- Database = source of truth ของ task/state/evidence
- Hermes = agent memory ไม่ใช่ primary database
- OpenClaw = agent/session communication ไม่ใช่ low-level event bus
- Harpoon = performance evidence ไม่ใช่ verifier ทั้งระบบ

## Documentation

อ่านแผนเต็มได้ที่ [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

หน้า roadmap อยู่ที่ [index.html](./index.html)

## GitHub Pages

workflow อยู่ที่ `.github/workflows/pages.yml`

หาก repository ยังไม่เคยเปิด Pages ให้ตั้ง `Settings → Pages → Build and deployment → Source → GitHub Actions` แล้วรัน workflow อีกครั้ง

---

**Principle:** Smaller Models, Bigger Possibilities — ความสามารถของ agent ต้องพิสูจน์ด้วย baseline, benchmark, regression และ evidence
