import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bcrypt from "bcryptjs";
import { initDb } from "../src/db/index.js";
import { createUser, getUserByUsername } from "../src/db/users.js";

/**
 * 관리자용 계정 발급 CLI (FR-01).
 *
 * 사용법:
 *   npm run create-user -w server -- --username kyoungtae --password temp1234 --name "경태"
 *   (인자를 생략하면 대화형으로 입력받는다.)
 */

interface Args {
  username?: string;
  password?: string;
  name?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--username") (args.username = value), i++;
    else if (key === "--password") (args.password = value), i++;
    else if (key === "--name") (args.name = value), i++;
  }
  return args;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

async function main(): Promise<void> {
  initDb();

  const args = parseArgs(process.argv.slice(2));
  const username = args.username ?? (await prompt("아이디(username): "));
  const displayName = args.name ?? (await prompt("표시이름(display name): "));
  const password = args.password ?? (await prompt("임시 비밀번호(password): "));

  if (!username || !displayName || !password) {
    console.error("[오류] username, name, password 는 모두 필수입니다.");
    process.exit(1);
  }

  if (getUserByUsername(username)) {
    console.error(`[오류] 이미 존재하는 아이디입니다: ${username}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = createUser({ username, passwordHash, displayName });

  console.log("계정이 생성되었습니다.");
  console.log(`  id: ${user.id}`);
  console.log(`  username: ${user.username}`);
  console.log(`  displayName: ${user.display_name}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[오류] 계정 생성 실패:", err);
  process.exit(1);
});
