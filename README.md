# WebAi

**AI Software Engineering CPU** — ระบบเว็บสำหรับควบคุม AI coding workflow โดยใช้โมเดลเล็กเป็นค่าเริ่มต้น และเพิ่มความสามารถจาก environment รอบโมเดล

## Vision

```text
AI CPU     = CONTROL
ECC        = KNOW HOW
OMP        = DO
OpenClaw   = COMMUNICATE
Hermes     = REMEMBER
Harpoon    = MEASURE
Tests      = VERIFY
Git        = HISTORY
Database   = STATE
```

เป้าหมายคือสร้างระบบที่รับคำสั่งจากผู้ใช้ผ่านมือถือ/เว็บ แล้วสามารถ:

1. วิเคราะห์งาน
2. วางแผน
3. แก้ repository จริง
4. build/test
5. เปิด live preview
6. ตรวจ verification gate
7. วัด performance
8. เก็บ evidence
9. เรียนรู้จาก failure/regression
10. escalate ไปโมเดลที่แรงขึ้นเฉพาะเมื่อจำเป็น

## Current Status

**Planning / Foundation — V0.1**

repo นี้เริ่มจาก architecture และ implementation roadmap ก่อนลง core application

- `index.html` — หน้า Architecture + Roadmap
- `IMPLEMENTATION_PLAN.md` — แผนพัฒนาเต็ม V0.1 → V1.0
- `.github/workflows/pages.yml` — static GitHub Pages deployment workflow

## Roadmap

| Version | Goal |
|---|---|
| V0.1 | Web + API + OMP + Git + Build/Test + Live Preview |
| V0.2 | AI CPU / Task Engine |
| V0.3 | ECC rules/skills integration |
| V0.4 | Verification Gate |
| V0.5 | Harpoon performance evidence |
| V0.6 | Hermes memory |
| V0.7 | OpenClaw multi-agent communication |
| V0.8 | Regression + Learning Loop |
| V0.9 | Smart model routing / cost control |
| V1.0 | Held-out benchmark + measurable improvement report |

## First Acceptance Test

`E2E-001 FOUNDATION LOOP`

```text
User
 ↓
Web UI
 ↓
API / AI CPU
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

ตัวอย่างคำสั่ง:

> เพิ่มหน้า `/hello` ที่แสดง “WebAi is running” และเพิ่ม test ให้ด้วย

V0.1 ผ่านเมื่อระบบแก้ไฟล์จริง, แสดง diff, build/test ผ่าน, preview เปิดได้, เก็บ evidence และ rollback ได้

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

- Git = source of truth ของ source code
- Database = source of truth ของ task/state/evidence
- Hermes = agent memory ไม่ใช่ primary database
- OpenClaw = agent/session communication ไม่ใช่ low-level event bus
- Harpoon = performance verifier ไม่ใช่ verifier ทั้งระบบ
- ECC = engineering knowledge/workflow ไม่ใช่ coding worker ซ้ำกับ OMP
- OMP = coding worker หลัก
- AI CPU = control plane และ routing authority

## Documentation

อ่านแผนเต็มได้ที่ [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

หน้า roadmap อยู่ที่ [index.html](./index.html)

## GitHub Pages

workflow ถูกเตรียมไว้ใน `.github/workflows/pages.yml` เพื่อ deploy static page จาก repository root

หาก GitHub Pages ของ repo ยังไม่ได้ตั้ง source เป็น **GitHub Actions** ให้เปิดที่:

`Settings → Pages → Build and deployment → Source → GitHub Actions`

จากนั้น push/commit ที่ `main` จะ trigger deployment workflow

---

**Principle:** Smaller Models, Bigger Possibilities — วัดผลด้วย baseline, benchmark, regression และ evidence ไม่ใช่ความรู้สึก
