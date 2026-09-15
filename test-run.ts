// Interactive virtual test run of a flow.yaml — no Telegram required.
// Plays the bot's side in the terminal: shows messages/buttons/invoices, you respond as the user.
import { FlowEngine, type FlowResult } from "./engine.ts";

const flowPath = Deno.args[0] ?? "./flow.yaml";
const engine = new FlowEngine();
engine.loadFlow(await Deno.readTextFile(flowPath));

const userId = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function print(line: string) {
  console.log(line);
}

// A single stdin.read() can return many lines at once (piped input) or a partial line
// (interactive typing) — buffer raw reads and hand out one line at a time.
let inputBuffer = "";
let stdinClosed = false;

async function readLine(): Promise<string | null> {
  while (true) {
    const nlIndex = inputBuffer.indexOf("\n");
    if (nlIndex !== -1) {
      const line = inputBuffer.slice(0, nlIndex);
      inputBuffer = inputBuffer.slice(nlIndex + 1);
      return line.replace(/\r$/, "").trim();
    }
    if (stdinClosed) {
      if (inputBuffer.length > 0) {
        const line = inputBuffer;
        inputBuffer = "";
        return line.trim();
      }
      return null;
    }
    const buf = new Uint8Array(4096);
    const n = await Deno.stdin.read(buf);
    if (n === null) {
      stdinClosed = true;
      continue;
    }
    inputBuffer += decoder.decode(buf.subarray(0, n));
  }
}

/** Returns the trimmed line, or null on EOF (stdin closed / Ctrl+D). */
async function prompt(question: string): Promise<string | null> {
  await Deno.stdout.write(encoder.encode(question));
  return readLine();
}

async function showResult(result: FlowResult): Promise<void> {
  if (result.kind === "invoice") {
    print(`\n💳 INVOICE: ${result.title}`);
    print(`   ${result.description}`);
    print(`   ${result.amount} ${result.currency}`);
    const ans = await prompt("   Simulate successful payment? [y/N] ");
    if (ans === null) {
      print("\n(input closed — ending test run)");
      return;
    }
    if (ans.toLowerCase() === "y" || ans.toLowerCase() === "yes") {
      return showResult(await engine.handlePaymentSuccess(userId));
    }
    print("   (payment not completed — a real user could just stop here, nothing else fires)");
    return;
  }

  if (result.media) {
    print(`\n📎 [${result.media.kind}] ${result.media.url}`);
  }
  print(`\n🤖 ${result.text}`);

  if (result.buttons?.length) {
    result.buttons.forEach((b, i) => print(`   [${i + 1}] ${b.label}`));
    const ans = await prompt("> ");
    if (ans === null) {
      print("\n(input closed — ending test run)");
      return;
    }
    const idx = parseInt(ans, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= result.buttons.length) {
      print("   (not a valid option, try again)");
      return showResult(result);
    }
    return showResult(await engine.handleCallback(userId, result.buttons[idx].next));
  }

  const ans = await prompt("> ");
  if (ans === null) {
    print("\n(input closed — ending test run)");
    return;
  }
  const pending = engine.handleText(userId, ans);
  if (!pending) {
    print("   (this step has no buttons and isn't waiting for a reply — dead end reached)");
    return;
  }
  return showResult(await pending);
}

print(`Testing ${flowPath} — type replies, pick buttons by number, Ctrl+D to quit.`);
await showResult(await engine.handleStart(userId));
print("\n— end of path —");
