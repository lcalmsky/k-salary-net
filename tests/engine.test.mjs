import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, floor10 } from '../js/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', '2026.json'), 'utf8'));
const table = JSON.parse(fs.readFileSync(path.join(root, 'data', data.simpleTable.file), 'utf8'));
const engine = createEngine(data, table);

const base = {
  annualGross: 50000000,
  family: 1,
  kids8to20: 0,
  age: 30,
  newHireAfter65: false,
  workType: 'regular',
  ratio: 1,
  nontax: { meal: 200000 },
  production: { overtimeMonthly: 0, prevYearTotalPay: 0 },
  daily: { wage: 200000, daysPerMonth: 20, insuredPensionHealth: true },
  sme: { enabled: false, type: 'youth', startMonth: 1 },
};

test('간이세액표 조회', () => {
  assert.equal(engine.tableTax(3966666, 1), 190620);
  assert.equal(engine.tableTax(3966666, 4), 88250);
  assert.equal(engine.tableTax(2300000, 1), 29160);
  assert.equal(engine.tableTax(8133333, 1), 986720);
  assert.equal(engine.tableTax(3510000, 1), 127220);
});

test('자녀세액공제 차감 (3,510,000원 · 가족 3명 · 자녀 1명)', () => {
  const tableValue = engine.tableTax(3510000, 3);
  assert.equal(engine.childDeduction(1), 20830);
  assert.equal(engine.withholdingTax(3510000, 3, 1, 1), tableValue - 20830);
});

test('1,000만원 초과 구간 공식', () => {
  const expected = floor10(1507400 + 2000000 * 0.98 * 0.35 + 25000);
  assert.equal(engine.tableTax(12000000, 1), expected);
});

test('월급여 정확히 1,000만원은 초과 구간 공식이 아니라 표 값', () => {
  assert.equal(engine.tableTax(10000000, 1), 1507400);
  assert.equal(engine.tableTax(10000000, 4), 1170840);
  assert.equal(engine.tableTax(9999999, 1), 1503990);
});

test('첫 행 미만은 0원', () => {
  assert.equal(engine.tableTax(500000, 1), 0);
  assert.equal(engine.tableTax(0, 4), 0);
});

test('중소기업 청년 감면은 연 200만원에서 멈춘다', () => {
  const output = engine.forward({
    ...base,
    annualGross: 60000000,
    age: 30,
    sme: { enabled: true, type: 'youth', startMonth: 1 },
  });
  const total = output.months.reduce((acc, month) => acc + month.reduction, 0);
  assert.equal(total, 2000000);

  const firstZero = output.months.findIndex((month) => month.reduction === 0);
  assert.ok(firstZero > 0, '감면 소진 월이 있어야 한다');
  for (let i = firstZero; i < 12; i++) {
    assert.equal(output.months[i].reduction, 0);
  }
  assert.ok(output.notes.some((note) => note.includes('중소기업') && note.includes('한도')));
  assert.ok(output.notes.some((note) => note.includes(`${firstZero}월에 중소기업 감면 한도`)));
});

test('생산직 연장·야간·휴일수당 비과세는 연 240만원 한도', () => {
  const output = engine.forward({
    ...base,
    annualGross: 30000000,
    workType: 'production',
    nontax: {},
    production: { overtimeMonthly: 300000, prevYearTotalPay: 30000000 },
  });
  const total = output.months.reduce((acc, month) => acc + month.nontaxOvertime, 0);
  assert.equal(total, 2400000);
  assert.equal(output.months[7].nontaxOvertime, 300000);
  assert.equal(output.months[8].nontaxOvertime, 0);
});

test('국민연금 기준소득월액 상한은 7월에 바뀐다', () => {
  const output = engine.forward({ ...base, annualGross: 84000000, nontax: {} });
  assert.equal(output.months[0].pension, floor10(6370000 * 0.0475));
  assert.equal(output.months[6].pension, floor10(6590000 * 0.0475));
  assert.ok(output.notes.some((note) => note.includes('7월부터')));
});

test('나이 기준 보험료 면제', () => {
  const age60 = engine.forward({ ...base, age: 60 });
  assert.equal(age60.months[0].pension, 0);

  const newHire = engine.forward({ ...base, age: 65, newHireAfter65: true });
  assert.equal(newHire.months[0].employment, 0);
  assert.ok(newHire.notes.some((note) => note.includes('65세')));
});

test('역산 왕복: 목표 실수령액 이상이 되는 최소 월 세전급여', () => {
  const results = [];
  for (let target = 1500000; target <= 12000000; target += 250000) {
    const inverse = engine.inverse({
      ...base,
      annualGross: undefined,
      monthlyNetTarget: target,
    });
    assert.ok(Number.isInteger(inverse.monthlyGross), '월 세전급여는 정수여야 한다');
    assert.ok(
      inverse.result.summary.averageNet >= target - 1e-9,
      `${target}원: 결과 ${inverse.result.summary.averageNet}원`,
    );
    const previous = engine.forward({
      ...base,
      annualGross: (inverse.monthlyGross - 1) * 12,
    }).summary.averageNet;
    assert.ok(previous < target - 1e-9, `${target}원: ${inverse.monthlyGross - 1}원에서 ${previous}원`);
    results.push({ target, iterations: inverse.iterations, method: inverse.method });
  }

  const histogram = {};
  for (const result of results) {
    histogram[`${result.method}:${result.iterations}`] = (histogram[`${result.method}:${result.iterations}`] || 0) + 1;
  }
  console.log('역산 반복 횟수 분포:', histogram);

  const fast = results.filter((result) => result.method === 'newton' && result.iterations <= 4).length;
  assert.ok(fast / results.length >= 0.9, `뉴턴 4회 이내 비율 ${fast}/${results.length}`);
});

test('월 60시간 미만 수준의 급여는 4대보험을 공제하지 않고 실수령이 음수가 되지 않는다', () => {
  const low = engine.forward({ ...base, annualGross: 68000, nontax: {} });
  const m = low.months[0];
  assert.equal(m.pension + m.health + m.ltc + m.employment, 0);
  assert.ok(low.summary.averageNet >= 0);
  assert.ok(low.notes.some((note) => note.includes('60시간 미만')));
  // 경계: 619,200원부터는 4대보험이 붙는다
  const atLimit = engine.forward({ ...base, annualGross: 619200 * 12, nontax: {} });
  assert.ok(atLimit.months[0].pension > 0);
});

test('단시간 경계: 619,199원은 미공제, 619,200원부터 공제', () => {
  const below = engine.forward({ ...base, annualGross: 619199 * 12, nontax: {} }).months[0];
  const at = engine.forward({ ...base, annualGross: 619200 * 12, nontax: {} }).months[0];
  assert.equal(below.pension + below.health + below.ltc + below.employment, 0);
  assert.equal(below.net, 619199);
  assert.ok(at.pension > 0 && at.health > 0 && at.employment > 0);
  // 경계에서 실수령이 줄어드는 구간이 있어도 역산은 목표 이상이 되는 최소 금액을 찾는다
  for (const target of [559040, 619199, 619200]) {
    const inv = engine.inverse({ ...base, annualGross: undefined, nontax: {}, monthlyNetTarget: target });
    assert.ok(inv.result.summary.averageNet >= target, `${target}`);
    const prev = engine.forward({ ...base, nontax: {}, annualGross: (inv.monthlyGross - 1) * 12 }).summary.averageNet;
    assert.ok(prev < target, `${target}: ${inv.monthlyGross - 1}원에서 ${prev}원`);
  }
});

test('일용근로자 일당 200,000원 원천징수', () => {
  const output = engine.forward({
    ...base,
    workType: 'daily',
    daily: { wage: 200000, daysPerMonth: 20, insuredPensionHealth: true },
  });
  const month = output.months[0];
  assert.equal(month.taxPerDay, floor10(50000 * 0.06 * 0.45));
  assert.equal(month.taxPerDay, 1350);
  assert.equal(month.localTaxPerDay, 130);
  assert.equal(month.incomeTax, 27000);
  assert.equal(month.localTax, 2600);
});
