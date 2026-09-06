const $ = (s) => document.querySelector(s);
const els = {apiBase:$("#apiBase"),token:$("#sessionToken"),save:$("#saveConfig"),health:$("#health"),model:$("#modelName"),send:$("#sendBtn"),plan:$("#planBtn"),omp:$("#ompBtn"),input:$("#taskInput"),messages:$("#messages"),planBox:$("#planBox"),log:$("#eventLog"),status:$("#taskStatus")};
const state={apiBase:localStorage.getItem("webai.apiBase")||"",token:localStorage.getItem("webai.sessionToken")||"",messages:[{role:"system",content:"You are WebAi, an AI software engineering assistant. Respond in the user's language."}]};
els.apiBase.value=state.apiBase;els.token.value=state.token;

function normalizedBase(){return (state.apiBase||"").trim().replace(/\/+$/,"")}
function api(path){const base=normalizedBase();if(!base)throw new Error("กรุณาตั้ง Backend API Base URL ของ VPS ก่อน");return `${base}${path}`}
function headers(){const h={"Content-Type":"application/json"};if(state.token)h["x-webai-token"]=state.token;return h}
function log(text,kind=""){const line=document.createElement("div");line.className=`logline ${kind}`;line.textContent=`[${new Date().toLocaleTimeString()}] ${text}`;els.log.prepend(line)}
function bubble(role,text){const wrap=document.createElement("div");wrap.className=`bubble ${role}`;const who=document.createElement("b"),body=document.createElement("div");who.textContent=role==="user"?"คุณ":"WebAi";body.textContent=text;wrap.append(who,body);els.messages.append(wrap);els.messages.scrollTop=els.messages.scrollHeight}
function setBusy(on,label="กำลังทำงาน"){els.send.disabled=on;els.plan.disabled=on;els.omp.disabled=on;els.status.textContent=on?label:"พร้อม"}
function setWaitingForBackend(){els.health.textContent="รอ Backend URL";els.health.className="pill warn";els.model.textContent="—";els.omp.textContent="OMP ยังไม่เชื่อม";els.omp.disabled=true}

async function request(path,body,timeoutMs=65000){
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const r=await fetch(api(path),{method:"POST",headers:headers(),body:JSON.stringify(body),signal:ctl.signal});
    const contentType=r.headers.get("content-type")||"";
    if(!contentType.includes("application/json")){
      const text=await r.text();
      throw new Error(`Backend ตอบกลับไม่ใช่ JSON (${r.status})${text.trim().startsWith("<!DOCTYPE")?" — ตรวจสอบ Backend URL ว่าไม่ได้ชี้ไป GitHub Pages":""}`);
    }
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
    return data;
  }finally{clearTimeout(t)}
}

async function health(){
  if(!normalizedBase()){setWaitingForBackend();return}
  try{
    const r=await fetch(api("/api/health"),{headers:headers()});
    const contentType=r.headers.get("content-type")||"";
    if(!contentType.includes("application/json")){
      const text=await r.text();
      throw new Error(`Backend URL ไม่ถูกต้อง${text.trim().startsWith("<!DOCTYPE")?" — URL นี้กำลังตอบหน้า HTML แทน API":""}`);
    }
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
    els.health.textContent=data.typhoonConfigured?"Typhoon พร้อม":"Backend พร้อม · ยังไม่มี Typhoon key";
    els.health.className=data.typhoonConfigured?"pill ok":"pill warn";
    els.model.textContent=data.model||"—";
    els.omp.textContent=data.ompEnabled?"ส่งให้ OMP":"OMP ยังปิด";
    els.omp.disabled=!data.ompEnabled;
    log(`Health OK · ${data.model||"unknown model"} · OMP ${data.ompEnabled?"ON":"OFF"}`,"ok");
  }catch(e){
    els.health.textContent="Backend ยังไม่เชื่อม";
    els.health.className="pill bad";
    els.model.textContent="—";
    els.omp.textContent="OMP ยังไม่เชื่อม";
    els.omp.disabled=true;
    log(`Health failed: ${e.message}`,"bad");
  }
}

els.save.addEventListener("click",()=>{
  state.apiBase=els.apiBase.value.trim();
  state.token=els.token.value.trim();
  localStorage.setItem("webai.apiBase",state.apiBase);
  localStorage.setItem("webai.sessionToken",state.token);
  if(!normalizedBase()){
    log("ล้าง Backend URL แล้ว — WebAi จะยังไม่เรียก API","");
    setWaitingForBackend();
    return;
  }
  log("บันทึก Backend URL / session token แล้ว");
  health();
});

els.send.addEventListener("click",async()=>{const text=els.input.value.trim();if(!text)return;bubble("user",text);state.messages.push({role:"user",content:text});els.input.value="";setBusy(true,"กำลังคุยกับ Typhoon");log("ส่งข้อความไป OpenTyphoon");try{const data=await request("/api/chat",{messages:state.messages}),answer=data.content||"(ไม่มีข้อความตอบกลับ)";state.messages.push({role:"assistant",content:answer});bubble("assistant",answer);log(`Typhoon ตอบแล้ว · ${data.latencyMs??"?"} ms`,"ok")}catch(e){bubble("assistant",`เชื่อมต่อไม่สำเร็จ: ${e.message}`);log(`Chat failed: ${e.message}`,"bad")}finally{setBusy(false)}});
els.plan.addEventListener("click",async()=>{const goal=els.input.value.trim();if(!goal)return;setBusy(true,"กำลังวางแผน");log("ขอ structured plan จาก Typhoon");try{const data=await request("/api/plan",{goal});els.planBox.textContent=JSON.stringify(data.plan,null,2);log("ได้ implementation plan แล้ว","ok")}catch(e){els.planBox.textContent=e.message;log(`Plan failed: ${e.message}`,"bad")}finally{setBusy(false)}});
els.omp.addEventListener("click",async()=>{const prompt=els.input.value.trim();if(!prompt)return;setBusy(true,"OMP กำลังทำงาน");log("ส่งงานให้ OMP RPC");try{const data=await request("/api/omp/prompt",{prompt},190000);bubble("assistant",data.content||"OMP ทำงานเสร็จแล้ว");log("OMP agent_end","ok")}catch(e){bubble("assistant",`OMP error: ${e.message}`);log(`OMP failed: ${e.message}`,"bad")}finally{setBusy(false)}});
els.input.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter")els.send.click()});
health();
