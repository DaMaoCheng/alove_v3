import { writeFileSync } from 'node:fs';
process.once('message', ({ operation, lane, job } = {}) => {
  if (operation === 'crash') process.exit(2);
  if (operation === 'silent') { setInterval(() => {}, 1000); return; }
  if (lane === 'background') {
    process.on('SIGTERM', () => {}); // Exercise confirmed forced termination.
    process.send({ type: 'claimed', job: { id: 'mem_job_fixture', jobType: 'send_proactive_message' } });
    process.send({ type: 'stage', stage: 'fixture_wait' });
    setTimeout(() => { if (job?.payload?.lateFile) writeFileSync(job.payload.lateFile, 'unsafe late write'); }, 1200);
    setInterval(() => {}, 1000);
    return;
  }
  process.send({ type: 'claimed', job: { id: 'mem_job_fixture_image', jobType: 'generate_chat_image' } });
  process.send({ type: 'result', ok: true, result: { worked: true, completed: true } }, () => process.exit(0));
});
