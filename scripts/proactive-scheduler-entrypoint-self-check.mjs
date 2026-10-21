import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

// A separate process links the real module to fake timers/DB/queue dependencies.
// No application import, database initialization, SQL execution or external calls.
if (!process.argv.includes('--child')) {
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url), '--child'], {
    encoding: 'utf8', timeout: 10000,
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.status !== 0) {
    if (child.stderr) process.stderr.write(child.stderr);
    throw new Error(`Scheduler entrypoint isolated child failed (${child.status ?? child.error?.code})`);
  }
} else {
  const tasks = [], timers = [], cleared = [], logs = [], unhandled = [];
  let unrefs = 0, checks = 0;
  const check = (ok, message) => { assert(ok, message); checks++; };
  const config = { proactiveScheduler: { enabled: true, pollMs: 4321, batchSize: 2 } };
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const context = vm.createContext({ Date, console: { error: (...args) => logs.push(args) },
    setInterval: (callback, ms) => { const timer = { callback, ms, unref: () => { unrefs++; } }; timers.push(timer); return timer; },
    clearInterval: timer => cleared.push(timer),
  });
  const stubDb = { execute: async sql => {
    if (sql.includes('FROM memory_jobs')) return [[]];
    return [[{ session_id:'fixture_session',user_id:'fixture_user',site_id:'fixture_site',character_id:'fixture_character',category_id:'mascot',time_zone:'UTC' }]];
  } };
  const dependencies = {
    './config.js': { SERVER_CONFIG: config },
    './db.js': { getDbPool: () => stubDb },
    './memory-job-service.js': { MEMORY_JOB_TYPES: { SEND_PROACTIVE_MESSAGE:'fixture_proactive' },
      enqueueMemoryJob: options => new Promise((resolve, reject) => tasks.push({ options, resolve, reject })), },
    './proactive-message-delivery-service.js': { resolveAccountProactiveDeliveryPlan: async (_db, options) => ({ allowed:true,selectedCandidate:options.candidates[0],deliveryMode:'idle_followup' }) },
    './proactive-scheduler-policy.js': { evaluateProactiveCandidate: () => ({}),
      groupProactiveCandidatesByUser: candidates => [{ userId:'fixture_user',siteId:'fixture_site',timeZone:'UTC',candidates }],
      PROACTIVE_SCHEDULER_POLICY: { maxUnansweredProactive:2,quietStartHour:23,quietEndHour:7 }, },
  };
  const source = readFileSync(new URL('../server/proactive-message-scheduler-service.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context, identifier:'actual-proactive-message-scheduler-service' });
  const flush = async () => { for (let index=0; index<5; index++) await new Promise(resolve => setImmediate(resolve)); };
  try {
    await module.link(specifier => {
      const exports = dependencies[specifier];
      assert(exports, `Unexpected dependency must not load: ${specifier}`);
      return new vm.SyntheticModule(Object.keys(exports), function() {
        for (const [key,value] of Object.entries(exports)) this.setExport(key,value);
      }, { context });
    });
    await module.evaluate();
    const scheduler = module.namespace;
    scheduler.startProactiveMessageScheduler();
    await flush();
    check(timers.length===1 && timers[0].ms===4321 && unrefs===1,'original interval and unref remain unchanged');
    check(tasks.length===1,'first start runs one actual scan and enqueue');
    check(tasks[0].options.priority===80 && tasks[0].options.jobType==='fixture_proactive','queue payload and priority remain original');
    scheduler.startProactiveMessageScheduler();
    timers[0].callback(); timers[0].callback();
    await flush();
    check(timers.length===1 && tasks.length===1,'repeated start and overlapping timer ticks never reenter the same scan');
    tasks[0].reject(Object.assign(new Error('private SQL text must not be logged'),{ code:'ER_LOCK_DEADLOCK',sql:'SECRET SQL' }));
    await flush();
    check(unhandled.length===0,'startup rejection must be handled by the scheduler-owned entrypoint');
    check(logs.length===1 && logs[0].length===2 && logs[0][1]==='ER_LOCK_DEADLOCK','startup logs only fixed prefix and safe bounded code');
    check(!JSON.stringify(logs).includes('private') && !JSON.stringify(logs).includes('SECRET SQL'),'no error message, SQL or error object is exposed');
    timers[0].callback(); await flush();
    check(tasks.length===2,'failure resets active state so the next normal interval proceeds');
    timers[0].callback(); await flush();
    check(tasks.length===2,'next pending cycle still prevents reentry');
    tasks[1].resolve({ id:'fixture_job' }); await flush();
    check(logs.length===1,'successful later cycle does not emit a failure log');
    timers[0].callback(); await flush();
    check(tasks.length===3,'successful completion permits the following scheduled cycle');
    tasks[2].reject({ code:'private sql or credential',message:'SECRET' }); await flush();
    check(unhandled.length===0 && logs.length===2 && logs[1][1]==='SCHEDULER_CYCLE_FAILED','interval rejection uses the same owner catcher and invalid codes are bounded');
    timers[0].callback(); await flush();
    check(tasks.length===4,'a second failure also leaves the next interval usable without immediate retry');
    let stopped = false;
    const stop = scheduler.stopProactiveMessageSchedulerAndWait().then(()=>{stopped=true;});
    await flush();
    check(cleared.length===1 && !stopped,'stop clears interval and waits for the existing cycle');
    timers[0].callback(); await flush();
    check(tasks.length===4,'stopping prevents any stale queued timer callback from starting work');
    tasks[3].reject(Object.assign(new Error('stop failure'),{code:'ER_LOCK_DEADLOCK'}));
    await stop; await flush();
    check(stopped && unhandled.length===0,'stop wait settles even when the in-flight cycle rejects');
    scheduler.startProactiveMessageScheduler(); await flush();
    check(timers.length===2 && tasks.length===5,'explicit restart preserves the existing lifecycle');
    tasks[4].resolve({}); await flush();
    const directError=Object.assign(new Error('awaited failure'),{code:'ER_LOCK_DEADLOCK'});
    const logCount=logs.length;
    const direct=scheduler.runProactiveMessageSchedulerCycle();
    const directRejection=assert.rejects(direct,error=>error===directError);
    await flush();
    check(tasks.length===6,'an explicit awaited cycle still runs actual scanning');
    tasks[5].reject(directError); await directRejection; await flush();
    check(logs.length===logCount && unhandled.length===0,'exported awaited cycle still rejects without swallowing or double logging');
    await scheduler.stopProactiveMessageSchedulerAndWait();
    config.proactiveScheduler.enabled=false;
    scheduler.startProactiveMessageScheduler(); await flush();
    check(timers.length===2 && tasks.length===6,'disabled scheduler still starts no timer or work');
    console.log(`proactive scheduler entrypoint self-check passed: ${checks} checks; isolated real module, fake timers/queue/DB, no initialization/network`);
  } finally {
    process.removeListener('unhandledRejection',onUnhandled);
  }
}
