#!/usr/bin/env node
// Wait until every host:port given on the command line accepts a TCP
// connection, or fail after WAIT_FOR_TIMEOUT_S seconds (default 90).
//
// Used by the Woodpecker workflows in .woodpecker/ to wait for their
// postgres / redis service containers. The official postgres image only
// listens on TCP after its init phase is done (the temporary init server is
// socket-only), so an open port means it is ready for queries.
//
//   node ci/woodpecker/scripts/wait-for.mjs postgres:5432 redis:6379
import net from 'node:net';

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: wait-for.mjs host:port [host:port ...]');
  process.exit(2);
}
const deadline = Date.now() + Number(process.env.WAIT_FOR_TIMEOUT_S ?? 90) * 1000;

function probe(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    s.setTimeout(2000);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => { s.destroy(); resolve(false); });
  });
}

for (const t of targets) {
  const i = t.lastIndexOf(':');
  const host = t.slice(0, i);
  const port = Number(t.slice(i + 1));
  if (!host || !Number.isInteger(port)) {
    console.error(`bad target: ${t}`);
    process.exit(2);
  }
  while (!(await probe(host, port))) {
    if (Date.now() > deadline) {
      console.error(`timed out waiting for ${t}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`${t} is accepting connections`);
}
