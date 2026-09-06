import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const TYPHOON_BASE_URL = (process.env.TYPHOON_BASE_URL || "https://api.opentyphoon.ai/v1").replace(/\/+$/, "");
const TYPHOON_MODEL = process.env.TYPHOON_MODEL || "typhoon-v2.5-30b-a3b-instruct";
const TYPHOON_API_KEY = process.env.TYPHOON_API_KEY || "";
const WEB_AUTH_TOKEN = process.env.WEB_AUTH_TOKEN || "";
const OMP_ENABLED = /^(1|true|yes)$/i.test(process.env.OMP_ENABLED || "");
const OMP_COMMAND = process.env.OMP_COMMAND || "omp";
const OMP_PROVIDER = process.env.OMP_PROVIDER || "opentyphoon";
const OMP_MODEL = process.env.OMP_MODEL || TYPHOON_MODEL;
const DEFAULT_WORKSPACE = process.env.WEBAI_WORKSPACE || process.cwd();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map(v => v.trim()).filter(Boolean);
const MAX_BODY = 64 * 1024;
const buckets = new Map();

function cors(req) {
  const origin = req.headers.origin || "";
  let allow = "*";
  if (!ALLOWED_ORIGINS.includes("*")) allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] || "";
  return {"Access-Control-Allow-Origin":allow,"Access-Control-Allow-Headers":"content-type,x-webai-token","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Vary":"Origin"};
}
function send(req,res,status,data){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",...cors(req)});res.end(JSON.stringify(data));}
function authOk(req){return !WEB_AUTH_TOKEN || req.headers["x-webai-token"] === WEB_AUTH_TOKEN;}
function rateOk(req){const ip=req.socket.remoteAddress||"unknown",minute=Math.floor(Date.now()/60000),key=`${ip}:${minute}`,count=(buckets.get(key)||0)+1;buckets.set(key,count);if(buckets.size>5000){for(const k of buckets.keys())if(!k.endsWith(`:${minute}`))buckets.delete(k)}return count<=30;}
async function bodyJson(req){let size=0,raw="";for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw Object.assign(new Error("request too large"),{status:413});raw+=chunk}if(!raw)return{};try{return JSON.parse(raw)}catch{throw Object.assign(new Error("invalid JSON"),{status:400})}}
function cleanMessages(value){if(!Array.isArray(value))return[];return value.slice(-40).map(m=>({role:["system","user","assistant"].includes(m?.role)?m.role:"user",content:String(m?.content||"").slice(0,12000)})).filter(m=>m.content.trim())}

async function typhoon(messages,{temperature=0.2,max_tokens=2048}={}){
  if(!TYPHOON_API_KEY)throw Object.assign(new Error("TYPHOON_API_KEY is not configured"),{status:503});
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),60000),started=Date.now();
  try{
    const r=await fetch(`${TYPHOON_BASE_URL}/chat/completions`,{method:"POST",headers:{"Authorization":`Bearer ${TYPHOON_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:TYPHOON_MODEL,messages,temperature,max_tokens}),signal:ctl.signal});
    const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={raw:text.slice(0,2000)}}
    if(!r.ok){const msg=data?.error?.message||data?.message||`Typhoon HTTP ${r.status}`;throw Object.assign(new Error(msg),{status:r.status>=500?502:r.status})}
    return{provider:"opentyphoon",model:data.model||TYPHOON_MODEL,content:data?.choices?.[0]?.message?.content||"",usage:data.usage||null,latencyMs:Date.now()-started,requestId:randomUUID()};
  }finally{clearTimeout(timer)}
}
async function planTask(goal){
  const system=`You are WebAi's planning layer. Return ONLY valid JSON, no markdown.\nSchema:\n{"goal":"string","risk":"low|medium|high","summary":"string","steps":[{"id":"P1","title":"string","acceptance":["string"]}],"worker":"omp"}\nCreate a concise software-engineering plan. Never include secrets.`;
  const out=await typhoon([{role:"system",content:system},{role:"user",content:String(goal).slice(0,12000)}],{temperature:0.1,max_tokens:1800});
  let plan;try{plan=JSON.parse(out.content)}catch{plan={goal:String(goal),risk:"medium",summary:out.content,steps:[],worker:"omp",parseWarning:true}}
  return{...out,plan};
}
function runOmp(prompt,workspace){
  if(!OMP_ENABLED)throw Object.assign(new Error("OMP bridge is disabled"),{status:503});
  const cwd=workspace||DEFAULT_WORKSPACE;
  return new Promise((resolve,reject)=>{
    const child=spawn(OMP_COMMAND,["--mode","rpc","--no-session"],{cwd,env:process.env,stdio:["pipe","pipe","pipe"]});
    let stdout="",stderr="",finalText="",done=false,buffer="";
    const timeout=setTimeout(()=>{child.kill("SIGKILL");reject(Object.assign(new Error("OMP timeout"),{status:504}))},180000);
    child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
    child.stderr.on("data",d=>{stderr=(stderr+d).slice(-20000)});
    child.stdout.on("data",d=>{stdout=(stdout+d).slice(-50000);buffer+=d;let nl;while((nl=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,nl).trim();buffer=buffer.slice(nl+1);if(!line)continue;try{const evt=JSON.parse(line);if(evt.type==="ready"){child.stdin.write(JSON.stringify({id:"m1",type:"set_model",provider:OMP_PROVIDER,modelId:OMP_MODEL})+"\n");child.stdin.write(JSON.stringify({id:"p1",type:"prompt",message:prompt})+"\n")}if(evt.type==="message_update"&&evt?.assistantMessageEvent?.type==="text_delta")finalText+=evt.assistantMessageEvent.delta||"";if(evt.type==="agent_end"){done=true;child.stdin.end()}}catch{}}});
    child.on("error",err=>{clearTimeout(timeout);reject(Object.assign(err,{status:503}))});
    child.on("close",code=>{clearTimeout(timeout);if(done&&code===0)return resolve({ok:true,content:finalText,stderr});reject(Object.assign(new Error(`OMP exited with code ${code}: ${stderr||stdout}`),{status:502}))});
  });
}

const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==="OPTIONS"){res.writeHead(204,cors(req));return res.end()}
    const url=new URL(req.url||"/",`http://${req.headers.host||"localhost"}`);
    if(req.method==="GET"&&url.pathname==="/api/health")return send(req,res,200,{ok:true,version:"0.1.0",provider:"opentyphoon",model:TYPHOON_MODEL,typhoonConfigured:Boolean(TYPHOON_API_KEY),ompEnabled:OMP_ENABLED});
    if(req.method==="GET"&&url.pathname==="/")return send(req,res,200,{name:"WebAi API",version:"0.1.0",health:"/api/health"});
    if(!rateOk(req))return send(req,res,429,{error:"rate_limited"});
    if(!authOk(req))return send(req,res,401,{error:"unauthorized"});
    if(req.method==="POST"&&url.pathname==="/api/chat"){const body=await bodyJson(req),messages=cleanMessages(body.messages);if(!messages.length)return send(req,res,400,{error:"messages_required"});return send(req,res,200,await typhoon(messages))}
    if(req.method==="POST"&&url.pathname==="/api/plan"){const body=await bodyJson(req);if(!String(body.goal||"").trim())return send(req,res,400,{error:"goal_required"});return send(req,res,200,await planTask(body.goal))}
    if(req.method==="POST"&&url.pathname==="/api/omp/prompt"){const body=await bodyJson(req);if(!String(body.prompt||"").trim())return send(req,res,400,{error:"prompt_required"});const result=await runOmp(String(body.prompt).slice(0,16000),body.workspace?String(body.workspace):undefined);return send(req,res,200,{worker:"omp",...result})}
    return send(req,res,404,{error:"not_found"});
  }catch(err){const status=Number(err?.status)||(err?.name==="AbortError"?504:500),message=err?.message||"server_error";return send(req,res,status,{error:message})}
});
server.listen(PORT,"0.0.0.0",()=>{console.log(`WebAi API listening on :${PORT}`);console.log(`Typhoon configured: ${Boolean(TYPHOON_API_KEY)} | OMP enabled: ${OMP_ENABLED}`)});
