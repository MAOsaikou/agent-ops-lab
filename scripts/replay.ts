import { defaultEventDbPath, openEventStore } from "../src/engine/events/store.js";
import { isRunId } from "../src/engine/ids.js";
import { replay } from "../src/engine/replay.js";

const runText = process.argv[2];
if (runText === undefined || !isRunId(runText)) {
  console.error("usage: pnpm replay <runId>");
  process.exit(1);
}

const store = openEventStore(defaultEventDbPath());
try {
  const folded = replay({ store, runId: runText });
  if (folded.lastSeq === 0) {
    console.error(`no events for ${runText}`);
    process.exit(1);
  }
  for (const round of folded.rounds) {
    console.log(round.hash);
  }
  console.log(`replay ok, final hash ${folded.finalHash}`);
} finally {
  store.close();
}
