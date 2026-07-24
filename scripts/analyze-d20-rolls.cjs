const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ quiet: true });

const FACES = 20;
const DEFAULT_WINDOWS = [100, 400, 1000];
const FILTER_OPTIONS = new Map([
  ['guild', 'guild_id'],
  ['channel', 'channel_id'],
  ['user', 'user_id'],
]);

function buildFilteredQuery(args) {
  const conditions = [];
  const values = [];
  for (const argument of args) {
    const match = /^--([^=]+)=(.+)$/.exec(argument);
    if (!match) throw new Error(`Invalid filter: ${argument}`);
    const [, name, value] = match;
    if (FILTER_OPTIONS.has(name)) {
      values.push(value);
      conditions.push(`${FILTER_OPTIONS.get(name)} = $${values.length}`);
    } else if (name === 'since' || name === 'until') {
      const timestamp = new Date(value);
      if (Number.isNaN(timestamp.getTime())) throw new Error(`Invalid ${name} timestamp: ${value}`);
      values.push(timestamp.toISOString());
      conditions.push(`created_at ${name === 'since' ? '>=' : '<'} $${values.length}`);
    } else {
      throw new Error(`Unknown filter: --${name}`);
    }
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return {
    text: `SELECT result FROM d20_roll${where} ORDER BY created_at, id`,
    values,
  };
}

function logGamma(value) {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.001208650973866179, -0.000005395239384953,
  ];
  let x = value;
  let y = value;
  let series = 1.000000000190015;
  for (const coefficient of coefficients) {
    y += 1;
    series += coefficient / y;
  }
  const temporary = x + 5.5;
  return (
    -temporary +
    Math.log(2.5066282746310005 * series) +
    (x + 0.5) * Math.log(temporary) -
    Math.log(x)
  );
}

function regularizedGammaQ(shape, value) {
  if (value < 0 || shape <= 0) return Number.NaN;
  if (value === 0) return 1;

  if (value < shape + 1) {
    let sum = 1 / shape;
    let term = sum;
    let nextShape = shape;
    for (let index = 1; index <= 100; index += 1) {
      nextShape += 1;
      term *= value / nextShape;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 3e-7) break;
    }
    const p = sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
    return 1 - p;
  }

  let b = value + 1 - shape;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let fraction = d;
  for (let index = 1; index <= 100; index += 1) {
    const coefficient = -index * (index - shape);
    b += 2;
    d = coefficient * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + coefficient / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) < 3e-7) break;
  }
  return Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * fraction;
}

function summarizeRolls(rolls) {
  const counts = Array(FACES).fill(0);
  for (const roll of rolls) {
    if (!Number.isInteger(roll) || roll < 1 || roll > FACES) {
      throw new Error(`Invalid d20 result: ${roll}`);
    }
    counts[roll - 1] += 1;
  }

  const sampleSize = rolls.length;
  const expected = sampleSize / FACES;
  const chiSquare =
    sampleSize === 0
      ? 0
      : counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
  const pValue = sampleSize === 0 ? null : regularizedGammaQ((FACES - 1) / 2, chiSquare / 2);

  return {
    sampleSize,
    expectedPerFace: expected,
    chiSquare,
    degreesOfFreedom: FACES - 1,
    pValue,
    faces: counts.map((count, index) => ({
      face: index + 1,
      count,
      percentage: sampleSize === 0 ? 0 : (count / sampleSize) * 100,
    })),
  };
}

function formatSummary(label, summary) {
  const lines = [
    `\n${label}: n=${summary.sampleSize}`,
    'face  count  percent',
    ...summary.faces.map(
      ({ face, count, percentage }) =>
        `${String(face).padStart(4)}  ${String(count).padStart(5)}  ${percentage.toFixed(2).padStart(7)}%`,
    ),
  ];
  if (summary.sampleSize === 0) lines.push('chi-square: insufficient data');
  else {
    lines.push(
      `chi-square=${summary.chiSquare.toFixed(3)} df=${summary.degreesOfFreedom} p=${summary.pValue.toFixed(6)}`,
    );
    if (summary.sampleSize < 100)
      lines.push('guidance: exploratory only; wait for at least 100 rolls before judging fairness');
    else if (summary.sampleSize < 400)
      lines.push('guidance: usable early signal; 400+ rolls provides a much stronger sample');
  }
  return lines.join('\n');
}

async function main() {
  const pool = new Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT),
    user: process.env.PG_USER,
    password: process.env.PG_PASS,
    database: process.env.PG_DB,
  });
  try {
    const query = buildFilteredQuery(process.argv.slice(2));
    const result = await pool.query(query.text, query.values);
    const rolls = result.rows.map((row) => Number(row.result));
    console.log(formatSummary('all recorded 1d20 rolls', summarizeRolls(rolls)));
    for (const windowSize of DEFAULT_WINDOWS) {
      console.log(
        formatSummary(
          `most recent ${Math.min(windowSize, rolls.length)} rolls (window ${windowSize})`,
          summarizeRolls(rolls.slice(-windowSize)),
        ),
      );
    }
  } finally {
    await pool.end();
  }
}

module.exports = { buildFilteredQuery, formatSummary, regularizedGammaQ, summarizeRolls };

if (require.main === module) {
  main().catch((error) => {
    console.error(`D20 analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
