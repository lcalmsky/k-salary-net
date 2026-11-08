import { DATA_YEAR, SITE } from './config.js';
import { createEngine } from './engine.js';

const $ = (id) => document.getElementById(id);

const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const shortWon = (n) => (n >= 10000 ? `${won(n / 10000)}만원` : `${won(n)}원`);
// 항목 하나(예: "연 공제 55,888,620원")가 중간에서 끊기지 않도록 항목 단위로 묶는다.
const segs = (parts, sep = ' · ') => parts.map((part) => `<span class="seg-nw">${part}</span>`).join(sep);
const parseWon = (value) => Number(String(value).replace(/[^0-9]/g, '')) || 0;

const state = {
  mode: 'fwd',
  amount: 50000000,
  family: 1,
  kids: 0,
  ratio: 1,
  age: 30,
  newHireAfter65: false,
  workType: 'regular',
  production: { overtimeMonthly: 0, prevYearTotalPay: 0 },
  daily: { wage: 200000, daysPerMonth: 20, insuredPensionHealth: true },
  nontax: {
    meal: 200000,
    car: 0,
    childcareKids: 0,
    childcarePerKid: 200000,
    research: 0,
    reporter: 0,
    remote: 0,
    seafarer: 0,
    relocation: 0,
    overseas: 0,
    overseasType: 'general',
  },
  sme: { enabled: false, type: 'youth', startMonth: 1 },
  clamped: {},
  smeTypeTouched: false,
  // 모드 전환 때 금액을 이어받기 위한 기록
  lastFwd: null, // { annual, net } : 연봉 모드의 마지막 계산 결과
  lastRev: null, // { net, annual } : 실수령 모드의 마지막 계산 결과
  pair: null, // { annual, net } : 연봉 모드에서 넘어간 짝. 입력이 그대로면 원래 연봉을 돌려준다
};

const QUICK_NONTAX = [
  { key: 'meal', label: '식대' },
  { key: 'car', label: '자가운전' },
  { key: 'childcareKids', label: '보육수당 1명' },
  { key: 'research', label: '연구보조비' },
  { key: 'reporter', label: '취재수당' },
];

let data = null;
let table = null;
let engine = null;

function capFor(key) {
  if (!data) return Infinity;
  const caps = data.nontax;
  switch (key) {
    case 'meal': return caps.meal.cap;
    case 'car': return caps.car.cap;
    case 'research': return caps.research.cap;
    case 'reporter': return caps.reporter.cap;
    case 'remote': return caps.remote.cap;
    case 'seafarer': return caps.seafarer.cap;
    case 'relocation': return caps.relocation.cap;
    case 'childcarePerKid': return caps.childcare.capPerKid;
    case 'overseas': return state.nontax.overseasType === 'special' ? caps.overseas.specialCap : caps.overseas.cap;
    default: return Infinity;
  }
}

function buildInput() {
  return {
    annualGross: state.mode === 'fwd' && state.workType !== 'daily' ? state.amount : undefined,
    monthlyNetTarget: state.mode === 'rev' ? state.amount : undefined,
    nontax: { ...state.nontax },
    family: state.family,
    kids8to20: state.kids,
    age: state.age,
    newHireAfter65: state.newHireAfter65,
    workType: state.workType,
    production: { ...state.production },
    daily: { ...state.daily },
    sme: { ...state.sme },
    ratio: state.ratio,
  };
}

function buildNontaxGrid() {
  const caps = data.nontax;
  const moneyField = (key, label, capText, unit = '원') => `
    <div class="nt">
      <label for="nt-${key}">${label} <span class="cap">${capText}</span></label>
      <div class="money small"><input id="nt-${key}" data-nt="${key}" inputmode="numeric" value="${won(state.nontax[key])}" autocomplete="off"><span>${unit}</span></div>
      <div class="capnote" data-capnote="${key}"></div>
    </div>`;

  const childcare = `
    <div class="nt">
      <label for="nt-childcarePerKid">보육수당 (6세 이하 자녀) <span class="cap">1명당 월 ${shortWon(caps.childcare.capPerKid)}</span></label>
      <div class="step"><button data-ntstep="childcareKids" data-delta="-1" aria-label="보육수당 자녀 줄이기">−</button><output id="out-childcareKids">${state.nontax.childcareKids}</output><button data-ntstep="childcareKids" data-delta="1" aria-label="보육수당 자녀 늘리기">+</button></div>
      <div class="money small" style="margin-top:6px"><input id="nt-childcarePerKid" data-nt="childcarePerKid" inputmode="numeric" value="${won(state.nontax.childcarePerKid)}" autocomplete="off"><span>원/명</span></div>
      <div class="capnote" data-capnote="childcare"></div>
    </div>`;

  const overseas = `
    <div class="nt">
      <label for="nt-overseas">국외근로 비과세 <span class="cap">일반 월 ${shortWon(caps.overseas.cap)} · 특수 월 ${shortWon(caps.overseas.specialCap)}</span></label>
      <div class="money small"><input id="nt-overseas" data-nt="overseas" inputmode="numeric" value="${won(state.nontax.overseas)}" autocomplete="off"><span>원</span></div>
      <select class="nt-select" id="nt-overseasType" aria-label="국외근로 유형">
        <option value="general">일반 국외근로 (월 ${shortWon(caps.overseas.cap)})</option>
        <option value="special">원양어선·외항선·해외건설 (월 ${shortWon(caps.overseas.specialCap)})</option>
      </select>
      <div class="capnote" data-capnote="overseas"></div>
    </div>`;

  $('nontax-grid').innerHTML = [
    moneyField('meal', '식대', `월 ${shortWon(caps.meal.cap)}`),
    moneyField('car', '자가운전보조금', `월 ${shortWon(caps.car.cap)}`),
    childcare,
    moneyField('research', '연구보조비·연구활동비', `월 ${shortWon(caps.research.cap)}`),
    moneyField('reporter', '취재수당', `월 ${shortWon(caps.reporter.cap)}`),
    moneyField('remote', '벽지수당', `월 ${shortWon(caps.remote.cap)}`),
    moneyField('seafarer', '승선수당', `월 ${shortWon(caps.seafarer.cap)}`),
    moneyField('relocation', '공공기관 이전지원금', `월 ${shortWon(caps.relocation.cap)}`),
    overseas,
  ].join('');

  $('nt-overseasType').value = state.nontax.overseasType;
}

function renderQuickNontax() {
  const box = $('quick-nontax');
  if (!box || !data) return;
  box.innerHTML = QUICK_NONTAX.map(({ key, label }) => {
    const on = state.nontax[key] > 0;
    const amount = key === 'childcareKids' ? data.nontax.childcare.capPerKid : capFor(key);
    return `<button type="button" data-qnt="${key}" class="${on ? 'on' : ''}" aria-pressed="${on}">${label} ${shortWon(amount)}</button>`;
  }).join('');
}

function buildSmeStart() {
  const select = $('sme-start');
  select.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}월</option>`).join('');
  select.value = String(state.sme.startMonth);
}

function updateAmountInput() {
  const input = $('amt');
  const label = $('amt-label');
  const unit = $('amt-unit');
  const daily = state.workType === 'daily';

  if (state.mode === 'fwd') {
    label.textContent = '연봉 (세전)';
    unit.textContent = '원/년';
    input.value = won(state.amount);
  } else {
    label.textContent = '원하는 월 실수령액';
    unit.textContent = '원/월';
    input.value = won(state.amount);
  }
  renderQuick();
}

function renderQuick() {
  const wrap = $('quick');
  if (state.workType === 'daily' && state.mode === 'fwd') {
    wrap.innerHTML = '';
    return;
  }
  // 누를 때마다 입력 금액에 더한다. '초기화'는 0으로 되돌린다.
  const steps = state.mode === 'fwd'
    ? [1000000, 5000000, 10000000, 50000000]
    : [100000, 500000, 1000000, 5000000];
  wrap.innerHTML = steps
    .map((v) => `<button type="button" data-quick="${v}">+${won(v / 10000)}만</button>`)
    .concat('<button type="button" data-quick="reset" class="reset">초기화</button>')
    .join('');
}

function syncVisibility() {
  const daily = state.workType === 'daily';
  const foreign = state.workType === 'foreign19';
  const amountVisible = !(daily && state.mode === 'fwd');

  $('amount-block').hidden = !amountVisible;
  $('daily-fields').hidden = !daily;
  $('day-wage-block').hidden = daily && state.mode === 'rev';
  $('family-row').hidden = daily || foreign;
  $('ratio-block').hidden = daily || foreign;
  $('production-fields').hidden = state.workType !== 'production';
  $('nontax-group').hidden = daily;
  $('quick-nontax').hidden = daily;
  $('quick-nontax-label').hidden = daily;
  $('sme-group').hidden = daily || foreign;
  $('newhire-block').hidden = !(state.age >= 65);
  $('sme-fields').hidden = !state.sme.enabled;

  $('m-fwd').classList.toggle('on', state.mode === 'fwd');
  $('m-rev').classList.toggle('on', state.mode === 'rev');
  $('m-fwd').setAttribute('aria-selected', String(state.mode === 'fwd'));
  $('m-rev').setAttribute('aria-selected', String(state.mode === 'rev'));
}

function syncSmeTypeButtons() {
  $('sme-type').querySelectorAll('button').forEach((button) => {
    button.classList.toggle('on', button.dataset.value === state.sme.type);
  });
}

function suggestSmeType() {
  if (state.smeTypeTouched) return;
  state.sme.type = state.age <= (data?.smeReduction.youth.ageMax ?? 34) ? 'youth' : 'other';
  syncSmeTypeButtons();
}

function updateCapNotes() {
  const flags = state.clamped;
  document.querySelectorAll('[data-capnote]').forEach((el) => {
    const key = el.dataset.capnote;
    if (!flags[key]) {
      el.textContent = '';
      return;
    }
    const cap = key === 'childcare' ? capFor('childcarePerKid') : capFor(key);
    el.textContent = `한도 ${won(cap)}원을 넘어 ${won(cap)}원까지만 반영했습니다.`;
  });
}

function renderProductionEligibility(input) {
  const el = $('prod-eligibility');
  if (state.workType !== 'production') {
    el.textContent = '';
    return;
  }
  const eligibility = engine.productionEligibility(input);
  if (eligibility.eligible) {
    el.className = 'eligibility ok';
    el.textContent = `비과세 요건 충족 · 월정액급여 ${won(eligibility.fixedPay)}원, 직전연도 총급여 ${won(eligibility.prevYearTotalPay)}원`;
  } else {
    el.className = 'eligibility bad';
    el.textContent = `비과세 요건 미충족 — ${eligibility.reasons.join(' ')}`;
  }
}

function deductionRows(month) {
  const daily = state.workType === 'daily';
  const foreign = state.workType === 'foreign19';
  return [
    {
      name: '국민연금',
      value: month.pension,
      rate: month.pension === 0 ? '미적용' : '4.75%',
      color: '--bar1',
    },
    {
      name: '건강보험',
      value: month.health,
      rate: '3.595%',
      color: '--bar2',
    },
    {
      name: '장기요양보험',
      value: month.ltc,
      rate: '건보료 × 0.9448/7.19',
      color: '--bar3',
    },
    {
      name: '고용보험',
      value: month.employment,
      rate: month.employment === 0 ? '미적용' : '0.9%',
      color: '--bar4',
    },
    {
      name: '소득세',
      value: month.incomeTax,
      rate: daily ? '일당 6%·55% 공제' : foreign ? '19% 단일세율' : `간이세액 ${Math.round(state.ratio * 100)}%`,
      color: '--bar5',
    },
    {
      name: '지방소득세',
      value: month.localTax,
      rate: '소득세 × 10%',
      color: '--bar6',
    },
  ];
}

function renderStack(month) {
  const gross = month.gross;
  if (!(gross > 0)) {
    $('stack').innerHTML = '';
    $('stack-legend').innerHTML = '';
    return;
  }
  const rows = deductionRows(month);
  const net = Math.max(month.net, 0);
  const netWidth = (net / gross) * 100;
  $('stack').innerHTML = `<i style="width:${netWidth}%;background:var(--accent);opacity:.22"></i>`
    + rows.map((row) => {
      const width = Math.max(0, (row.value / gross) * 100);
      return `<i style="width:${width}%;background:var(${row.color})"></i>`;
    }).join('');
  $('stack-legend').innerHTML = `<span><i style="background:var(--accent);opacity:.4"></i>실수령</span>`
    + rows.map((row) => `<span><i style="background:var(${row.color})"></i>${row.name}</span>`).join('');
}

function renderBreakdown(month) {
  const rows = deductionRows(month);
  let html = '';
  if (month.nontax > 0) {
    html += `<tr class="sub"><td>비과세 (세전에서 제외)</td><td>-${won(month.nontax)}원</td></tr>`;
  }
  html += rows.map((row) => `<tr><td><span class="dot" style="background:var(${row.color})"></span>${row.name}<span class="rate">${row.rate}</span></td><td>${won(row.value)}원</td></tr>`).join('');
  if (month.reduction > 0) {
    html += `<tr class="sub"><td>중소기업 취업자 감면</td><td>-${won(month.reduction)}원</td></tr>`;
  }
  html += `<tr class="total"><td>공제 합계</td><td>${won(month.totalDeduction)}원</td></tr>`;
  html += `<tr class="net"><td>월 실수령액</td><td>${won(month.net)}원</td></tr>`;
  $('tbl').innerHTML = html;
}

function renderMonths(output) {
  const hasReduction = output.months.some((month) => month.reduction > 0);
  let html = `<thead><tr><th>월</th><th>세전</th><th>비과세</th><th>공제 합계</th>${hasReduction ? '<th>감면</th>' : ''}<th>실수령</th></tr></thead><tbody>`;
  for (const month of output.months) {
    html += `<tr class="${month.reduction > 0 ? 'disc' : ''}"><td>${month.month}월</td><td>${won(month.gross)}</td><td>${won(month.nontax)}</td><td>${won(month.totalDeduction)}</td>${hasReduction ? `<td>${month.reduction > 0 ? `-${won(month.reduction)}` : '–'}</td>` : ''}<td>${won(month.net)}</td></tr>`;
  }
  html += '</tbody>';
  $('months-tbl').innerHTML = html;
}

function render() {
  if (!engine) return;
  syncVisibility();
  updateCapNotes();
  renderQuickNontax();

  const input = buildInput();
  let output = null;
  let inverseInfo = null;

  try {
    if (state.mode === 'fwd') {
      output = engine.forward(input);
    } else {
      if (state.amount > 0) {
        inverseInfo = engine.inverse(input);
        output = inverseInfo.result;
      }
    }
  } catch (error) {
    console.error(error);
    $('r-k').textContent = '계산 중 오류가 발생했습니다';
    $('r-big').textContent = '—';
    $('r-alt').textContent = String(error.message || error);
    return;
  }

  renderProductionEligibility(
    state.mode === 'rev' && output
      ? { ...input, annualGross: output.months[0].gross * 12 }
      : input,
  );

  if (!output) {
    $('r-k').textContent = '금액을 입력해 주세요';
    $('r-big').innerHTML = '0<em>원</em>';
    $('r-alt').textContent = '';
    $('tbl').innerHTML = '';
    $('stack').innerHTML = '';
    $('stack-legend').innerHTML = '';
    $('notes').innerHTML = '';
    $('r-varies').hidden = true;
    $('toggle-months').hidden = true;
    $('months-wrap').hidden = true;
    return;
  }

  const daily = state.workType === 'daily';
  if (daily && state.mode === 'fwd') state.lastDailyNet = Math.round(output.summary.averageNet);
  if (!daily && state.mode === 'fwd') {
    state.lastFwd = { annual: state.amount, net: Math.round(output.summary.averageNet) };
  }
  if (!daily && state.mode === 'rev') {
    // 연봉 모드에서 넘어온 실수령액 그대로면, 역산 최솟값 대신 원래 연봉으로 보여 준다.
    // 원래 연봉도 실수령 목표 이상을 만족하므로 올바른 답이다.
    const pairOutput = state.pair && state.pair.net === state.amount
      ? engine.forward({ ...input, annualGross: state.pair.annual, monthlyNetTarget: undefined })
      : null;
    // 그 사이 가족 수·비과세 등이 바뀌어 원래 연봉이 목표에 못 미치면 역산 결과를 그대로 쓴다.
    if (pairOutput && pairOutput.summary.averageNet >= state.amount - 0.5) {
      output = pairOutput;
      inverseInfo = { ...inverseInfo, annualGross: state.pair.annual, monthlyGross: state.pair.annual / 12, result: output, fromPair: true };
    }
    state.lastRev = { net: state.amount, annual: inverseInfo.annualGross };
  }
  const summary = output.summary;
  const monthForDisplay = output.months[0];

  if (state.mode === 'fwd') {
    $('r-k').textContent = daily ? '월 예상 실수령액 (일당 기준)' : '월 예상 실수령액 (연평균)';
    $('r-big').innerHTML = `${won(summary.averageNet)}<em>원</em>`;
    const monthlyGross = daily
      ? state.daily.wage * state.daily.daysPerMonth
      : state.amount / 12;
    $('r-alt').innerHTML = segs([`연 실수령 ${won(summary.annualNet)}원`, `월 세전 ${won(monthlyGross)}원`, `연 공제 ${won(summary.annualDeductions)}원`]);
  } else if (daily) {
    $('r-k').textContent = '필요한 일당 (세전)';
    $('r-big').innerHTML = `${won(inverseInfo.dailyWage)}<em>원/일</em>`;
    $('r-alt').innerHTML = segs([`월 세전 ${won(monthForDisplay.gross)}원`, `실수령 ${won(summary.averageNet)}원`], ' → ');
  } else {
    $('r-k').textContent = '필요한 연봉 (세전)';
    $('r-big').innerHTML = `${won(inverseInfo.annualGross)}<em>원/년</em>`;
    $('r-alt').innerHTML = segs([`월 세전 ${won(inverseInfo.monthlyGross)}원`, `실수령 ${won(summary.averageNet)}원`], ' → ');
  }

  const variesEl = $('r-varies');
  if (state.mode === 'fwd' && summary.varies) {
    const reducedMonth = output.months.find((month) => month.reduction > 0);
    const normalMonth = output.months.find((month) => month.reduction === 0 && month.month >= state.sme.startMonth);
    if (state.sme.enabled && reducedMonth) {
      variesEl.innerHTML = normalMonth
        ? segs([`감면 적용 중 월 ${won(reducedMonth.net)}원`, `한도 소진 후 월 ${won(normalMonth.net)}원`, `연평균 ${won(summary.averageNet)}원`], ' / ')
        : segs([`감면 적용 중 월 ${won(reducedMonth.net)}원`, `연평균 ${won(summary.averageNet)}원`], ' / ');
    } else {
      variesEl.innerHTML = segs([`1월 ${won(output.months[0].net)}원`, `12월 ${won(output.months[11].net)}원`, `연평균 ${won(summary.averageNet)}원`], ' / ');
    }
    variesEl.hidden = false;
  } else {
    variesEl.hidden = true;
  }

  renderStack(monthForDisplay);
  renderBreakdown(monthForDisplay);
  renderMonths(output);

  const notesEl = $('notes');
  notesEl.innerHTML = output.notes.map((note) => `<li>${note}</li>`).join('');


  const toggle = $('toggle-months');
  toggle.hidden = false;
  toggle.setAttribute('aria-expanded', String(!$('months-wrap').hidden));
  toggle.textContent = $('months-wrap').hidden ? '12개월 표 보기' : '12개월 표 접기';
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  if (state.workType === 'daily') {
    // 일용직: 일당으로 계산한 월 실수령액을 역산 목표로 넘긴다.
    if (mode === 'rev') state.amount = state.lastDailyNet || 3000000;
  } else {
    if (mode === 'rev' && state.lastFwd) {
      state.pair = { ...state.lastFwd };
      state.amount = state.lastFwd.net;
    } else if (mode === 'fwd' && state.pair && state.lastRev && state.lastRev.net === state.pair.net) {
      state.amount = state.pair.annual;
    } else if (mode === 'fwd' && state.lastRev) {
      state.amount = state.lastRev.annual;
    }
  }
  updateAmountInput();
  render();
}

document.addEventListener('click', (event) => {
  const qnt = event.target.closest('[data-qnt]');
  if (qnt) {
    const key = qnt.dataset.qnt;
    if (key === 'childcareKids') {
      state.nontax.childcareKids = state.nontax.childcareKids > 0 ? 0 : 1;
      if (!state.nontax.childcarePerKid) state.nontax.childcarePerKid = data.nontax.childcare.capPerKid;
    } else {
      state.nontax[key] = state.nontax[key] > 0 ? 0 : capFor(key);
      state.clamped[key] = false;
    }
    buildNontaxGrid();
    render();
    return;
  }
  const step = event.target.closest('[data-step]');
  if (step) {
    const key = step.dataset.step;
    const delta = Number(step.dataset.delta) || 0;
    // 8~20세 자녀도 부양가족에 포함되므로 자녀 수는 부양가족 수 − 1(본인)을 넘을 수 없다.
    if (key === 'family') {
      state.family = Math.max(1, state.family + delta);
      state.kids = Math.min(state.kids, state.family - 1);
    }
    if (key === 'kids') {
      state.kids = Math.max(0, state.kids + delta);
      state.family = Math.max(state.family, state.kids + 1);
    }
    $('family').textContent = state.family;
    $('kids').textContent = state.kids;
    render();
    return;
  }

  const ntStep = event.target.closest('[data-ntstep]');
  if (ntStep) {
    const key = ntStep.dataset.ntstep;
    const delta = Number(ntStep.dataset.delta) || 0;
    state.nontax[key] = Math.max(0, Math.min(6, state.nontax[key] + delta));
    $(`out-${key}`).textContent = state.nontax[key];
    render();
    return;
  }

  const quick = event.target.closest('[data-quick]');
  if (quick) {
    const step = quick.dataset.quick;
    state.amount = step === 'reset' ? 0 : (state.amount || 0) + Number(step);
    $('amt').value = state.amount ? won(state.amount) : '';
    render();
    return;
  }

  const ratio = event.target.closest('#ratio [data-value]');
  if (ratio) {
    state.ratio = Number(ratio.dataset.value);
    $('ratio').querySelectorAll('button').forEach((button) => {
      button.classList.toggle('on', button === ratio);
    });
    render();
    return;
  }

  const smeType = event.target.closest('#sme-type [data-value]');
  if (smeType) {
    state.sme.type = smeType.dataset.value;
    state.smeTypeTouched = true;
    syncSmeTypeButtons();
    render();
  }
});

function bindEvents() {
  $('m-fwd').addEventListener('click', () => setMode('fwd'));
  $('m-rev').addEventListener('click', () => setMode('rev'));

  $('amt').addEventListener('input', (event) => {
    const value = parseWon(event.target.value);
    state.amount = value;
    event.target.value = value ? won(value) : '';
    render();
  });

  $('detail-toggle').addEventListener('click', () => {
    const detail = $('detail');
    const open = detail.hidden;
    detail.hidden = !open;
    $('detail-toggle').setAttribute('aria-expanded', String(open));
  });

  $('age').addEventListener('input', (event) => {
    state.age = Math.max(0, Math.min(120, Number(event.target.value) || 0));
    if (state.age < 65) state.newHireAfter65 = false;
    $('newhire').checked = state.newHireAfter65;
    if (state.sme.enabled) suggestSmeType();
    render();
  });

  $('newhire').addEventListener('change', (event) => {
    state.newHireAfter65 = event.target.checked;
    render();
  });

  document.querySelectorAll('input[name="worker"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
      const wasDaily = state.workType === 'daily';
      state.workType = event.target.value;
      if (wasDaily !== (state.workType === 'daily')) {
        // 일용직과 월급제는 입력 금액의 의미가 달라 이어받지 않는다.
        state.pair = null;
        state.lastFwd = null;
        state.lastRev = null;
        state.amount = state.mode === 'fwd' ? 50000000 : 3000000;
      }
      updateAmountInput();
      render();
    });
  });

  $('ot-monthly').addEventListener('input', (event) => {
    const value = parseWon(event.target.value);
    state.production.overtimeMonthly = value;
    event.target.value = value ? won(value) : '';
    render();
  });
  $('prev-pay').addEventListener('input', (event) => {
    const value = parseWon(event.target.value);
    state.production.prevYearTotalPay = value;
    event.target.value = value ? won(value) : '';
    render();
  });

  $('day-wage').addEventListener('input', (event) => {
    const value = parseWon(event.target.value);
    state.daily.wage = value;
    event.target.value = value ? won(value) : '';
    render();
  });
  $('day-count').addEventListener('input', (event) => {
    const value = Math.max(0, Math.min(31, Number(event.target.value.replace(/[^0-9]/g, '')) || 0));
    state.daily.daysPerMonth = value;
    event.target.value = String(value);
    render();
  });
  $('day-insured').addEventListener('change', (event) => {
    state.daily.insuredPensionHealth = event.target.checked;
    render();
  });

  $('sme-enabled').addEventListener('change', (event) => {
    state.sme.enabled = event.target.checked;
    state.smeTypeTouched = false;
    if (state.sme.enabled) suggestSmeType();
    render();
  });
  $('sme-start').addEventListener('change', (event) => {
    state.sme.startMonth = Number(event.target.value) || 1;
    render();
  });

  $('toggle-months').addEventListener('click', () => {
    const wrap = $('months-wrap');
    wrap.hidden = !wrap.hidden;
    render();
  });

  document.addEventListener('input', (event) => {
    const input = event.target.closest('[data-nt]');
    if (!input) return;
    const key = input.dataset.nt;
    const value = parseWon(input.value);
    state.nontax[key] = value;
    if (value <= capFor(key)) state.clamped[key] = false;
    input.value = value ? won(value) : '';
    render();
  });

  document.addEventListener('change', (event) => {
    const input = event.target.closest('[data-nt]');
    if (input) {
      const key = input.dataset.nt;
      const cap = capFor(key);
      const value = parseWon(input.value);
      const flagKey = key === 'childcarePerKid' ? 'childcare' : key;
      if (value > cap) {
        state.nontax[key] = cap;
        state.clamped[flagKey] = true;
        input.value = won(cap);
      } else {
        state.nontax[key] = value;
        state.clamped[flagKey] = false;
        input.value = value ? won(value) : '';
      }
      render();
      return;
    }

    if (event.target.id === 'nt-overseasType') {
      state.nontax.overseasType = event.target.value;
      if (state.nontax.overseas > capFor('overseas')) {
        state.nontax.overseas = capFor('overseas');
        $('nt-overseas').value = won(state.nontax.overseas);
      }
      state.clamped.overseas = false;
      render();
    }
  });
}

function initTheme() {
  let current = 'system';
  try { current = localStorage.getItem('theme') || 'system'; } catch (e) { /* 저장소를 못 쓰면 시스템 설정 */ }
  if (!['system', 'light', 'dark'].includes(current)) current = 'system';
  const apply = (theme) => {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    document.querySelectorAll('[data-theme-set]').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.themeSet === theme));
    });
  };
  apply(current);
  $('theme-seg').addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-set]');
    if (!button) return;
    const theme = button.dataset.themeSet;
    try {
      if (theme === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
    } catch (e) { /* 저장 실패해도 이번 화면에는 적용 */ }
    apply(theme);
  });
}

// 데이터 로드 성공 여부와 상관없이 테마 버튼, Star 링크, 방문자 배지는 동작해야 한다.
initTheme();

function initSite() {
  const star = $('star-pill');
  star.href = `https://github.com/${SITE.REPO}`;

  if (!SITE.COUNTER_BADGE || location.hostname !== SITE.COUNTER_HOST) return;
  const img = $('counter-img');
  img.src = SITE.COUNTER_BADGE;
  img.hidden = false;
}

async function boot() {
  try {
    const yearResponse = await fetch(`data/${DATA_YEAR}.json`);
    if (!yearResponse.ok) throw new Error(`data/${DATA_YEAR}.json (${yearResponse.status})`);
    data = await yearResponse.json();
    const tableResponse = await fetch(`data/${data.simpleTable.file}`);
    if (!tableResponse.ok) throw new Error(`data/${data.simpleTable.file} (${tableResponse.status})`);
    table = await tableResponse.json();
    engine = createEngine(data, table);
  } catch (error) {
    console.error(error);
    $('r-k').textContent = '데이터를 불러오지 못했습니다';
    $('r-big').textContent = '—';
    $('r-alt').textContent = '폴더에서 python3 -m http.server 를 실행한 뒤 다시 열어 주세요.';
    return;
  }

  $('table-badge').textContent = `간이세액표 ${data.simpleTable.effective} 시행`;

  buildNontaxGrid();
  buildSmeStart();
  bindEvents();
  updateAmountInput();
  syncSmeTypeButtons();
  render();
}

initSite();
boot();
