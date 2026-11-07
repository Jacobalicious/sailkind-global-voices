// Makes a sign-in for sailkind.com/admin. The password stays on this computer; only a
// salted hash is printed, to paste into the script's Script Properties.
// Run: node admin/set-login.mjs
import { createHmac, randomBytes } from "node:crypto";

const HASH_ROUNDS = 1000;  // keep in step with hashPassword_ in admin/Code.gs
const MIN_LENGTH = 12;

function hashPassword(password, salt) {
  let h = password;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = createHmac("sha256", salt).update(h, "utf8").digest("hex");
  }
  return h;
}

// Reads one line without echoing it when typed at a terminal.
function ask(label, { hidden = false } = {}) {
  return new Promise(resolve => {
    process.stdout.write(label);
    const stdin = process.stdin;
    const tty = hidden && stdin.isTTY;
    if (tty) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let line = "";
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === "\u0003") process.exit(1);  // Ctrl+C, which raw mode would otherwise swallow
        if (ch === "\b" || ch === "\u007f") { line = line.slice(0, -1); continue; }
        if (ch !== "\r" && ch !== "\n") { line += ch; continue; }
        stdin.off("data", onData);
        if (tty) stdin.setRawMode(false);
        stdin.pause();
        if (hidden) process.stdout.write("\n");
        return resolve(line);
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const username = (await ask("Username: ")).trim().toLowerCase();
  if (!/^[a-z0-9_]{1,64}$/.test(username)) {
    throw new Error("Use 1 to 64 letters, numbers or underscores for the username.");
  }
  const password = await ask("Password: ", { hidden: true });
  if (password.length < MIN_LENGTH) throw new Error(`Use at least ${MIN_LENGTH} characters.`);
  if (await ask("Password again: ", { hidden: true }) !== password) throw new Error("Those didn't match.");

  const salt = randomBytes(16).toString("hex");
  console.log(`
In the Apps Script editor, open Project Settings > Script Properties and add:

  Property: login_${username}
  Value:    ${salt}:${hashPassword(password, salt)}

To change the password, run this again and replace the value.
To remove a reviewer, delete the property.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
