#!/usr/bin/env node
/* ============================================================
   동구리 오피스 서버 v3
   - office.html을 서빙하고, 직원들의 실제 작업을 Claude Code(구독)로 실행
   - 사용법:  node server.js   →  http://localhost:3777
============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const PORT = 3777;
const HTML = path.join(__dirname, 'office.html');
const TIMEOUT_MS = 15 * 60 * 1000; // 직원 1명당 최대 15분

// ---------- CLI 존재 확인 ----------
function checkCli(cmd){
  return new Promise(res=>{
    execFile(cmd, ['--version'], {timeout:10000}, (err, stdout)=>{
      res(err ? null : String(stdout).trim().split('\n')[0]);
    });
  });
}

// ---------- Claude Code 실행 ----------
function runClaude({prompt, system, model, mode, thinking, cwd}){
  return new Promise((resolve)=>{
    const args = ['-p', '--output-format', 'json'];
    if(model) args.push('--model', model);
    if(system) args.push('--append-system-prompt', system);
    if(mode === 'plan') args.push('--permission-mode', 'plan');
    else if(mode === 'full') args.push('--dangerously-skip-permissions');
    else args.push('--permission-mode', 'acceptEdits');

    const env = {...process.env};
    if(thinking === 'high') env.MAX_THINKING_TOKENS = '16000';
    else if(thinking === 'max') env.MAX_THINKING_TOKENS = '32000';

    const child = spawn('claude', args, {cwd, env});
    let out = '', err = '';
    const killer = setTimeout(()=>{ child.kill('SIGTERM'); }, TIMEOUT_MS);
    child.stdout.on('data', d=> out += d);
    child.stderr.on('data', d=> err += d);
    child.on('error', e=> { clearTimeout(killer); resolve({ok:false, error:'claude 실행 실패: '+e.message}); });
    child.on('close', code=>{
      clearTimeout(killer);
      try{
        const j = JSON.parse(out);
        if(j.is_error) return resolve({ok:false, error:j.result || 'Claude Code 오류'});
        return resolve({ok:true, text:j.result || '', cost:j.total_cost_usd, turns:j.num_turns});
      }catch(e){
        if(code === 0 && out.trim()) return resolve({ok:true, text: out.trim()});
        return resolve({ok:false, error: (err || out || '알 수 없는 오류').slice(0, 500)});
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------- Codex CLI 실행 (실험적) ----------
function runCodex({prompt, system, mode, thinking, model, cwd}){
  return new Promise((resolve)=>{
    const tmp = path.join(os.tmpdir(), 'codex-last-'+Date.now()+'.txt');
    const sandbox = mode === 'plan' ? 'read-only' : (mode === 'full' ? 'danger-full-access' : 'workspace-write');
    const full = (system ? system + '\n\n' : '') + prompt;
    const args = ['exec', '--sandbox', sandbox, '--skip-git-repo-check', '--output-last-message', tmp];
    if(model) args.push('-m', model);
    if(thinking === 'high' || thinking === 'max') args.push('-c', 'model_reasoning_effort=high');
    args.push(full);
    const child = spawn('codex', args, {cwd});
    let err = '';
    const killer = setTimeout(()=>{ child.kill('SIGTERM'); }, TIMEOUT_MS);
    child.stderr.on('data', d=> err += d);
    child.on('error', e=> { clearTimeout(killer); resolve({ok:false, error:'codex 실행 실패: '+e.message}); });
    child.on('close', ()=>{
      clearTimeout(killer);
      try{
        const text = fs.readFileSync(tmp, 'utf-8').trim();
        fs.unlinkSync(tmp);
        if(text) return resolve({ok:true, text});
      }catch(e){}
      resolve({ok:false, error:'Codex 결과 없음: '+err.slice(0,300)});
    });
  });
}

// ---------- HTTP ----------
function json(res, code, obj){
  res.writeHead(code, {'content-type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res)=>{
  if(req.method === 'GET' && (req.url === '/' || req.url === '/index.html')){
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
    res.end(fs.readFileSync(HTML));
    return;
  }
  if(req.method === 'GET' && req.url === '/api/health'){
    const [claude, codex] = await Promise.all([checkCli('claude'), checkCli('codex')]);
    return json(res, 200, {ok:true, claude, codex, defaultDir: path.resolve(__dirname, '..')});
  }
  if(req.method === 'POST' && req.url === '/api/run'){
    let body = '';
    req.on('data', d=> body += d);
    req.on('end', async ()=>{
      try{
        const p = JSON.parse(body);
        const cwd = p.cwd && fs.existsSync(p.cwd) ? p.cwd : path.resolve(__dirname, '..');
        console.log(`[${new Date().toTimeString().slice(0,8)}] ${p.engine||'claude'}/${p.model||'-'} (${p.mode}) 작업 시작 @ ${cwd}`);
        const t0 = Date.now();
        const r = p.engine === 'codex'
          ? await runCodex({prompt:p.prompt, system:p.system, mode:p.mode, thinking:p.thinking, model:p.model, cwd})
          : await runClaude({prompt:p.prompt, system:p.system, model:p.model, mode:p.mode, thinking:p.thinking, cwd});
        console.log(`  → ${r.ok?'완료':'실패'} (${Math.round((Date.now()-t0)/1000)}초)${r.ok?'':' :: '+r.error}`);
        json(res, 200, r);
      }catch(e){
        json(res, 400, {ok:false, error:e.message});
      }
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, ()=>{
  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │   동구리 오피스 서버 가동중             │');
  console.log('  │   브라우저에서 여세요:                  │');
  console.log(`  │   http://localhost:${PORT}                 │`);
  console.log('  └─────────────────────────────────────────┘');
  console.log('');
});
