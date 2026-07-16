const path = require('node:path');
const { ESLint } = require('eslint');

const RULE_ID = 'local/discord-boundary';
const FINDING_PATTERN = /family=([^ ]+) method=([^ ]+) status=([^;]+);/;

async function main() {
  const eslint = new ESLint({ cwd: process.cwd() });
  const results = await eslint.lintFiles(['src/**/*.ts']);
  const boundaryFindings = [];
  const blockingResults = [];

  for (const result of results) {
    const blockingMessages = [];

    for (const message of result.messages) {
      if (message.ruleId === RULE_ID) {
        const match = FINDING_PATTERN.exec(message.message);
        boundaryFindings.push({
          file: path.relative(process.cwd(), result.filePath),
          line: message.line,
          column: message.column,
          family: match?.[1] ?? 'unknown',
          method: match?.[2] ?? 'unknown',
          status: match?.[3] ?? 'unknown',
        });
      } else if (message.fatal || message.severity === 2) {
        blockingMessages.push(message);
      }
    }

    if (blockingMessages.length > 0) {
      blockingResults.push({ ...result, messages: blockingMessages });
    }
  }

  boundaryFindings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.method.localeCompare(right.method),
  );

  for (const finding of boundaryFindings) {
    console.log(
      `${finding.file}:${finding.line}:${finding.column} ` +
        `family=${finding.family} method=${finding.method} status=${finding.status}`,
    );
  }
  console.log(`Discord boundary findings: ${boundaryFindings.length}`);

  if (blockingResults.length > 0) {
    const formatter = await eslint.loadFormatter('stylish');
    console.error(formatter.format(blockingResults));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Discord boundary audit failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
