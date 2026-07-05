#!/usr/bin/env node
/* ============================================================
   동구리 오피스 서버 v4 — 실시간 진행 스트리밍
   사용법:  node server.js   →  http://localhost:3777
============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const PORT = 3777;
const HTML = path.join(__dirname, 'office.html');
const TIMEOUT_MS = 15 * 60 * 1000;
const active = new Set(); // 실행 중인 직원 프로세스

function checkCli(cmd){
  return new Promise(res=>{
    execFile(cmd, ['--version'], {timeout:10000}, (err, stdout)=>{
      res(err ? null : String(stdout).trim().split('\n')[0]);
    });
  });
}
function json(res, code, obj){
  res.writeHead(code, {'content-type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}

// 도구 사용 이벤트를 짧은 한국어 라벨로
function toolLabel(name, input){
  input = input || {};
  const f = input.file_path || input.path || input.notebook_path || '';
  const short = f ? f.split('/').slice(-2).join('/') : '';
  switch(name){
    case 'Read': return '📖 읽는 중: '+short;
    case 'Write': return '📝 쓰는 중: '+short;
    case 'Edit': case 'MultiEdit': return '✏️ 수정 중: '+short;
    case 'Bash': return '💻 실행: '+String(input.command||'').slice(0,60);
    case 'Grep': case 'Glob': return '🔍 검색: '+String(input.pattern||'').slice(0,40);
    case 'TodoWrite': return '🗒️ 할 일 정리 중';
    case 'WebSearch': return '🌐 웹 검색: '+String(input.query||'').slice(0,40);
    case 'WebFetch': return '🌐 페이지 확인 중';
    case 'Task': return '👥 하위 작업 실행 중';
    default: return '🔧 '+name;
  }
}

// ---------- 스트리밍 실행 ----------
function streamRun(res, p){
  res.writeHead(200, {'content-type':'application/x-ndjson; charset=utf-8'});
  const send = obj => { try{ res.write(JSON.stringify(obj)+'\n'); }catch(e){} };
  let finished = false;
  const done = obj => { if(finished) return; finished = true; send({type:'result', ...obj}); res.end(); };

  const cwd = p.cwd && fs.existsSync(p.cwd) ? p.cwd : path.resolve(__dirname, '..');
  const t0 = Date.now();
  console.log(`[${new Date().toTimeString().slice(0,8)}] ${p.engine||'claude'}/${p.model||'-'} (${p.mode}) 시작 @ ${cwd}`);
  const finish = r => {
    console.log(`  → ${r.ok?'완료':'실패'} (${Math.round((Date.now()-t0)/1000)}초)${r.ok?'':' :: '+(r.error||'')}`);
    done(r);
  };

  if(p.engine === 'codex'){
    const tmp = path.join(os.tmpdir(), 'codex-last-'+Date.now()+'.txt');
    const sandbox = p.mode==='plan' ? 'read-only' : (p.mode==='full' ? 'danger-full-access' : 'workspace-write');
    const full = (p.system ? p.system+'\n\n' : '') + p.prompt;
    const args = ['exec','--sandbox',sandbox,'--skip-git-repo-check','--output-last-message',tmp];
    if(p.thinking==='high'||p.thinking==='max') args.push('-c','model_reasoning_effort=high');
    if(p.model) args.push('-m', p.model);
    args.push(full);
    const child = spawn('codex', args, {cwd, stdio:['ignore','pipe','pipe']}); // stdin 없음 → 입력 대기 원천 차단
    active.add(child);
    const killer = setTimeout(()=>child.kill('SIGTERM'), TIMEOUT_MS);
    let errBuf = '';
    const onLine = d => {
      String(d).split('\n').forEach(l=>{
        l = l.trim();
        if(l && !l.startsWith('[') && l.length > 3) send({type:'progress', msg:l.slice(0,90)});
      });
    };
    child.stdout.on('data', onLine);
    child.stderr.on('data', d=>{ errBuf += d; onLine(d); });
    child.on('error', e=>{ clearTimeout(killer); active.delete(child); finish({ok:false, error:'codex 실행 실패: '+e.message}); });
    child.on('close', ()=>{
      clearTimeout(killer); active.delete(child);
      try{
        const text = fs.readFileSync(tmp,'utf-8').trim();
        fs.unlinkSync(tmp);
        if(text) return finish({ok:true, text});
      }catch(e){}
      finish({ok:false, error:'Codex 결과 없음: '+errBuf.slice(0,300)});
    });
    return;
  }

  // Claude Code (stream-json)
  const args = ['-p','--output-format','stream-json','--verbose'];
  if(p.model) args.push('--model', p.model);
  if(p.system) args.push('--append-system-prompt', p.system);
  if(p.mode==='plan') args.push('--permission-mode','plan');
  else if(p.mode==='full') args.push('--dangerously-skip-permissions');
  else args.push('--permission-mode','acceptEdits');

  const env = {...process.env};
  if(p.thinking==='high') env.MAX_THINKING_TOKENS='16000';
  else if(p.thinking==='max') env.MAX_THINKING_TOKENS='32000';

  const child = spawn('claude', args, {cwd, env});
  active.add(child);
  const killer = setTimeout(()=>child.kill('SIGTERM'), TIMEOUT_MS);
  let buf = '', errBuf = '', result = null;

  child.stdout.on('data', d=>{
    buf += d;
    let i;
    while((i = buf.indexOf('\n')) >= 0){
      const line = buf.slice(0, i).trim(); buf = buf.slice(i+1);
      if(!line) continue;
      let ev; try{ ev = JSON.parse(line); }catch(e){ continue; }
      if(ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)){
        ev.message.content.forEach(b=>{
          if(b.type === 'tool_use') send({type:'progress', msg: toolLabel(b.name, b.input)});
          else if(b.type === 'text' && b.text && b.text.trim())
            send({type:'progress', msg: '💬 '+b.text.trim().replace(/\s+/g,' ').slice(0,80)});
        });
      } else if(ev.type === 'result'){
        result = {ok: !ev.is_error, text: ev.result || '', error: ev.is_error ? (ev.result||'Claude Code 오류') : undefined};
      }
    }
  });
  child.stderr.on('data', d=> errBuf += d);
  child.on('error', e=>{ clearTimeout(killer); active.delete(child); finish({ok:false, error:'claude 실행 실패: '+e.message}); });
  child.on('close', ()=>{
    clearTimeout(killer); active.delete(child);
    if(result) finish(result);
    else finish({ok:false, error:'작업이 중단되었습니다'+(errBuf?' :: '+errBuf.slice(0,200):'')});
  });
  child.stdin.write(p.prompt);
  child.stdin.end();
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res)=>{
  if(req.method==='GET' && (req.url==='/'||req.url==='/index.html')){
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
    res.end(fs.readFileSync(HTML));
    return;
  }
  if(req.method==='GET' && req.url==='/api/health'){
    const [claude, codex] = await Promise.all([checkCli('claude'), checkCli('codex')]);
    return json(res, 200, {ok:true, claude, codex, defaultDir: path.resolve(__dirname,'..')});
  }
  if(req.method==='POST' && req.url==='/api/cancel'){
    let n = 0;
    for(const ch of active){ try{ ch.kill('SIGTERM'); n++; }catch(e){} }
    active.clear();
    console.log(`[취소] 실행 중이던 작업 ${n}개 중단`);
    return json(res, 200, {ok:true, killed:n});
  }
  if(req.method==='POST' && req.url==='/api/save'){
    let body='';
    req.on('data', d=>body+=d);
    req.on('end', ()=>{
      try{
        const p = JSON.parse(body);
        const cwd = p.cwd && fs.existsSync(p.cwd) ? p.cwd : path.resolve(__dirname,'..');
        const dir = path.join(cwd,'office-reports');
        fs.mkdirSync(dir,{recursive:true});
        const safe = String(p.title||'보고서').replace(/[\\/:*?"<>|]/g,'_').slice(0,60);
        const stamp = new Date().toISOString().slice(0,16).replace('T','_').replace(':','');
        fs.writeFileSync(path.join(dir,`${stamp}_${safe}.md`), p.content||'', 'utf-8');
        json(res,200,{ok:true, path:path.join(dir,`${stamp}_${safe}.md`)});
      }catch(e){ json(res,400,{ok:false,error:e.message}); }
    });
    return;
  }
  if(req.method==='POST' && req.url==='/api/run'){
    let body='';
    req.on('data', d=>body+=d);
    req.on('end', ()=>{
      try{ streamRun(res, JSON.parse(body)); }
      catch(e){ json(res,400,{ok:false,error:e.message}); }
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, ()=>{
  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │   동구리 오피스 서버 가동중              │');
  console.log(`  │   http://localhost:${PORT}                   │`);
  console.log('  └─────────────────────────────────────────┘');
  console.log('');
});
