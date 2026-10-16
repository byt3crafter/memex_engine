// Stands in for `openclaw agent ... --session-id <id> --message-file <path> --json`.
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
const prompt = readFileSync(arg('--message-file'), 'utf8');
const sawContext = prompt.includes('Earlier in this conversation');
const sawFile = /Attached files, saved for you to read:\n- (.*) \(/.exec(prompt);
const fileText = sawFile ? readFileSync(sawFile[1], 'utf8').trim() : null;
console.log(
  JSON.stringify({
    ok: true,
    payloads: [{ text: `session=${arg('--session-id')} context=${sawContext} file=${fileText}` }],
    meta: { durationMs: 1 },
  }),
);
