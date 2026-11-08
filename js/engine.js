/**
 * 2026년 근로소득 ↔ 실수령액 계산 엔진.
 * DOM 을 쓰지 않는 순수 ES 모듈이라 브라우저와 node:test 에서 함께 쓴다.
 * 모든 요율과 한도는 createEngine 에 넘긴 연도 데이터에서만 읽는다.
 */

export const floor10 = (n) => Math.floor((n + 1e-6) / 10) * 10;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const sumValues = (object) => Object.values(object).reduce((a, b) => a + b, 0);

const won = (n) => Math.round(n).toLocaleString('ko-KR');

export function createEngine(data, table) {
  const rows = table.rows;
  const tableMin = rows[0][0];
  const familyMax = data.simpleTable.familyMax ?? 11;
  const over10m = data.simpleTable.over10m;

  function rowFor(taxable) {
    if (taxable < tableMin) return null;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const row = rows[mid];
      if (taxable < row[0]) hi = mid - 1;
      else if (taxable >= row[1]) lo = mid + 1;
      else return row;
    }
    return null;
  }

  function baseTableTax(taxable, family) {
    if (taxable >= over10m[0].min) {
      const t10 = table.at10m[family - 1];
      if (taxable === over10m[0].min) return t10;
      const segment = over10m.find((s) => s.max == null || taxable <= s.max) ?? over10m[over10m.length - 1];
      return t10 + segment.base + (taxable - segment.from) * segment.rate * segment.mult;
    }
    const row = rowFor(taxable);
    if (!row) return 0;
    return row[family + 1];
  }

  function tableTax(taxable, family) {
    const f = Math.max(1, Math.floor(Number(family) || 1));
    if (f <= familyMax) return baseTableTax(taxable, f);
    const tMax = baseTableTax(taxable, familyMax);
    const tPrev = baseTableTax(taxable, familyMax - 1);
    return Math.max(tMax - (tPrev - tMax) * (f - familyMax), 0);
  }

  function childDeduction(kids) {
    const k = Math.max(0, Math.floor(Number(kids) || 0));
    const cd = data.simpleTable.childDeduction;
    if (k <= 0) return 0;
    if (k === 1) return cd.one;
    if (k === 2) return cd.two;
    return cd.two + (k - 2) * cd.perExtra;
  }

  function withholdingTax(taxable, family, kids, ratio = 1) {
    const base = Math.max(tableTax(taxable, family) - childDeduction(kids), 0);
    return Math.max(floor10(base * ratio), 0);
  }

  function nontaxItems(input) {
    const n = input.nontax || {};
    const caps = data.nontax;
    const kidCount = Math.max(0, Math.min(Math.floor(Number(n.childcareKids) || 0), caps.childcare.maxKids ?? 6));
    const perKid = Math.max(0, Number(n.childcarePerKid) || 0);
    const overseasSpecial = n.overseasType === 'special';
    return {
      meal: clamp(Number(n.meal) || 0, 0, caps.meal.cap),
      car: clamp(Number(n.car) || 0, 0, caps.car.cap),
      childcare: clamp(perKid * kidCount, 0, caps.childcare.capPerKid * kidCount),
      research: clamp(Number(n.research) || 0, 0, caps.research.cap),
      reporter: clamp(Number(n.reporter) || 0, 0, caps.reporter.cap),
      remote: clamp(Number(n.remote) || 0, 0, caps.remote.cap),
      seafarer: clamp(Number(n.seafarer) || 0, 0, caps.seafarer.cap),
      relocation: clamp(Number(n.relocation) || 0, 0, caps.relocation.cap),
      overseas: clamp(Number(n.overseas) || 0, 0, overseasSpecial ? caps.overseas.specialCap : caps.overseas.cap),
    };
  }

  function pensionCapFor(month) {
    const caps = data.pension.caps;
    return caps.find((c) => month >= c.fromMonth && month <= c.toMonth) ?? caps[caps.length - 1];
  }

  function productionEligibility(input) {
    const prod = input.production || {};
    const gross = Number(input.annualGross || 0) / 12;
    const otherNontax = sumValues(nontaxItems(input));
    const overtimeMonthly = Math.max(0, Number(prod.overtimeMonthly) || 0);
    const prevYearTotalPay = Math.max(0, Number(prod.prevYearTotalPay) || 0);
    const fixedPay = gross - overtimeMonthly - otherNontax;
    const rules = data.nontax.productionOvertime;
    const reasons = [];
    if (fixedPay > rules.monthlyFixedPayCap) {
      reasons.push(`월정액급여가 ${won(fixedPay)}원으로 기준 ${won(rules.monthlyFixedPayCap)}원을 넘습니다.`);
    }
    if (prevYearTotalPay > rules.prevYearTotalPayCap) {
      reasons.push(`직전연도 총급여가 ${won(prevYearTotalPay)}원으로 기준 ${won(rules.prevYearTotalPayCap)}원을 넘습니다.`);
    }
    return { eligible: reasons.length === 0, fixedPay, prevYearTotalPay, reasons };
  }

  function addClampNotes(notes, input) {
    const n = input.nontax || {};
    const caps = data.nontax;
    const pairs = [
      ['식대', n.meal, caps.meal.cap],
      ['자가운전보조금', n.car, caps.car.cap],
      ['연구보조비·연구활동비', n.research, caps.research.cap],
      ['취재수당', n.reporter, caps.reporter.cap],
      ['벽지수당', n.remote, caps.remote.cap],
      ['승선수당', n.seafarer, caps.seafarer.cap],
      ['공공기관 이전지원금', n.relocation, caps.relocation.cap],
    ];
    for (const [label, value, cap] of pairs) {
      if ((Number(value) || 0) > cap) {
        notes.push(`${label}은 월 ${won(cap)}원까지만 비과세되어 초과분은 과세 대상으로 계산했습니다.`);
      }
    }
    const kids = Math.min(Math.floor(Number(n.childcareKids) || 0), caps.childcare.maxKids ?? 6);
    if (kids > 0 && (Number(n.childcarePerKid) || 0) > caps.childcare.capPerKid) {
      notes.push(`보육수당은 자녀 1명당 월 ${won(caps.childcare.capPerKid)}원까지만 비과세되어 초과분은 과세 대상으로 계산했습니다.`);
    }
    const cap = n.overseasType === 'special' ? caps.overseas.specialCap : caps.overseas.cap;
    if ((Number(n.overseas) || 0) > cap) {
      notes.push(`국외근로 비과세는 월 ${won(cap)}원까지만 인정되어 초과분은 과세 대상으로 계산했습니다.`);
    }
  }

  function forward(input) {
    const workType = input.workType || 'regular';
    if (workType === 'daily') return forwardDaily(input);

    const ratio = Number(input.ratio ?? 1);
    const family = Math.max(1, Math.floor(Number(input.family) || 1));
    const kids = Math.max(0, Math.floor(Number(input.kids8to20) || 0));
    const age = Number(input.age ?? 30);
    const annualGross = Number(input.annualGross || 0);
    const gross = annualGross / 12;
    const items = nontaxItems(input);
    const otherNontax = sumValues(items);
    const isProduction = workType === 'production';
    const prod = input.production || {};
    const overtimeMonthly = isProduction ? Math.max(0, Number(prod.overtimeMonthly) || 0) : 0;
    const eligibility = isProduction ? productionEligibility(input) : null;
    const sme = input.sme || {};
    const smeEnabled = Boolean(sme.enabled) && workType !== 'foreign19';
    const smeRate = sme.type === 'other' ? data.smeReduction.other.rate : data.smeReduction.youth.rate;
    const smeStart = clamp(Math.floor(Number(sme.startMonth) || 1), 1, 12);
    const otCap = data.nontax.productionOvertime.annualCap;
    const smeCap = data.smeReduction.annualCap;
    // 월급여가 최저임금 × 월 60시간보다 적으면 월 60시간 미만 단시간근로로 보고 4대보험을 공제하지 않는다.
    const st = data.shortTime;
    const shortTimeLimit = st ? st.minimumWageHourly * st.monthlyHours : 0;
    const shortTime = gross > 0 && gross < shortTimeLimit;
    const months = [];
    let otUsed = 0;
    let otExhaustMonth = 0;
    let smeUsed = 0;
    let smeExhaustMonth = 0;

    for (let month = 1; month <= 12; month++) {
      let nontaxOvertime = 0;
      if (isProduction && eligibility.eligible) {
        nontaxOvertime = Math.min(overtimeMonthly, Math.max(0, otCap - otUsed));
        if (nontaxOvertime > 0 && !otExhaustMonth && otUsed + nontaxOvertime >= otCap) otExhaustMonth = month;
        otUsed += nontaxOvertime;
      }
      const nontax = otherNontax + nontaxOvertime;
      const taxable = Math.max(gross - nontax, 0);
      const cap = pensionCapFor(month);
      const pension = !shortTime && age < data.pension.ageExemptFrom && taxable > 0
        ? floor10(clamp(taxable, cap.min, cap.max) * data.pension.employeeRate)
        : 0;
      const health = shortTime ? 0 : floor10(taxable * data.health.employeeRate);
      const ltc = floor10(health * (data.ltc.totalRate / data.health.totalRate));
      const employment = shortTime || input.newHireAfter65 ? 0 : floor10(taxable * data.employment.employeeRate);
      let incomeTax = workType === 'foreign19'
        ? floor10(gross * data.foreignFlat.rate)
        : withholdingTax(taxable, family, kids, ratio);
      let reduction = 0;
      if (smeEnabled && month >= smeStart) {
        reduction = Math.min(floor10(incomeTax * smeRate), Math.max(0, smeCap - smeUsed));
        smeUsed += reduction;
        incomeTax -= reduction;
        if (!smeExhaustMonth && smeUsed >= smeCap) smeExhaustMonth = month;
      }
      const localTax = floor10(incomeTax * data.localIncomeTaxRate);
      const totalDeduction = pension + health + ltc + employment + incomeTax + localTax;
      months.push({
        month,
        gross,
        nontax,
        nontaxOvertime,
        nontaxItems: items,
        taxable,
        pension,
        health,
        ltc,
        employment,
        incomeTax,
        reduction,
        localTax,
        totalDeduction,
        net: gross - totalDeduction,
        productionEligible: eligibility ? eligibility.eligible : undefined,
      });
    }

    const notes = [];
    addClampNotes(notes, input);
    if (isProduction) {
      if (!eligibility.eligible) {
        notes.push(`생산직 연장·야간·휴일근로수당 비과세 요건을 충족하지 못했습니다. ${eligibility.reasons.join(' ')}`);
      } else if (otExhaustMonth) {
        notes.push(`${otExhaustMonth}월에 생산직 연장·야간·휴일근로수당 비과세 한도(연 ${won(otCap)}원)에 도달해 이후 월부터 해당 수당이 과세됩니다.`);
      }
    }
    if (shortTime) {
      notes.push(`월 세전급여가 ${won(shortTimeLimit)}원(2026년 최저임금 ${won(st.minimumWageHourly)}원 × 월 ${st.monthlyHours}시간) 미만이라 월 60시간 미만 단시간근로로 보고 4대보험을 공제하지 않았습니다. 3개월 이상 계속 근로하면 고용보험이 적용될 수 있습니다.`);
    }
    if (age >= data.pension.ageExemptFrom) {
      notes.push('만 60세 이상은 국민연금 당연가입 대상이 아니어서 연금보험료를 공제하지 않았습니다.');
    }
    if (input.newHireAfter65 && age >= 65) {
      notes.push('65세 이후 신규 입사자는 실업급여 보험료를 내지 않아 고용보험료를 공제하지 않았습니다.');
    }
    if (months[0].pension !== months[6].pension) {
      const cap = pensionCapFor(7);
      notes.push(`7월부터 국민연금 기준소득월액 상한액이 ${won(cap.max)}원(하한 ${won(cap.min)}원)으로 바뀌어 연금보험료가 조정됩니다.`);
    }
    if (smeEnabled) {
      if (smeExhaustMonth && smeExhaustMonth < 12) {
        notes.push(`${smeExhaustMonth}월에 중소기업 감면 한도 ${won(smeCap)}원에 도달해 ${smeExhaustMonth + 1}월부터 소득세가 정상 징수됩니다.`);
      } else {
        notes.push(`중소기업 취업자 소득세 감면(과세기간별 ${won(smeCap)}원 한도)을 ${smeStart}월부터 적용했습니다.`);
      }
    }
    if (workType === 'foreign19') {
      notes.push('외국인 단일세율 19%를 선택한 경우 소득세는 총급여의 19%로 계산하며, 비과세·소득공제·세액공제·감면은 적용되지 않습니다.');
      notes.push('단, 국민연금·건강보험·고용보험은 소득세와 별개 법률에 따라 계산합니다.');
    }
    if (ratio !== 1) {
      notes.push(`간이세액표 세액의 ${Math.round(ratio * 100)}%만 원천징수하는 것으로 계산했습니다. 연말정산에서 차액이 정산됩니다.`);
    }

    return { months, summary: summarize(months), notes };
  }

  function forwardDaily(input) {
    const daily = input.daily || {};
    const wage = Math.max(0, Number(daily.wage) || 0);
    const days = Math.max(0, Number(daily.daysPerMonth) || 0);
    const insured = daily.insuredPensionHealth !== false;
    const age = Number(input.age ?? 30);
    const gross = wage * days;
    const rawTaxPerDay = wage > data.daily.dailyDeduction
      ? (wage - data.daily.dailyDeduction) * data.daily.rate * (1 - data.daily.creditRate)
      : 0;
    let taxPerDay = floor10(rawTaxPerDay);
    if (taxPerDay < data.daily.minTax) taxPerDay = 0;
    const localTaxPerDay = floor10(taxPerDay * data.localIncomeTaxRate);
    const incomeTax = taxPerDay * days;
    const localTax = localTaxPerDay * days;
    const employment = input.newHireAfter65 ? 0 : floor10(gross * data.employment.employeeRate);
    const months = [];

    for (let month = 1; month <= 12; month++) {
      const cap = pensionCapFor(month);
      const pension = insured && age < data.pension.ageExemptFrom && gross > 0
        ? floor10(clamp(gross, cap.min, cap.max) * data.pension.employeeRate)
        : 0;
      const health = insured ? floor10(gross * data.health.employeeRate) : 0;
      const ltc = insured ? floor10(health * (data.ltc.totalRate / data.health.totalRate)) : 0;
      const totalDeduction = pension + health + ltc + employment + incomeTax + localTax;
      months.push({
        month,
        gross,
        nontax: 0,
        nontaxOvertime: 0,
        taxable: gross,
        pension,
        health,
        ltc,
        employment,
        incomeTax,
        reduction: 0,
        localTax,
        totalDeduction,
        net: gross - totalDeduction,
        taxPerDay,
        localTaxPerDay,
        days,
      });
    }

    const notes = [
      '일용근로자는 1일 15만원을 공제한 뒤 6% 세율을 적용하고, 산출세액의 55%를 공제해 소득세를 계산했습니다.',
      '일별 소득세가 1,000원 미만이면 소액부징수로 0원 처리했습니다.',
    ];
    if (!insured) {
      notes.push('연금·건강보험은 1개월 이상, 월 8일 이상 근무 등 직장가입자 요건이 있을 때 적용되므로 이번 계산에서는 제외했습니다.');
    }
    if (months[0].pension !== months[6].pension) {
      notes.push('7월부터 국민연금 기준소득월액 상·하한이 올라 연금보험료가 바뀝니다.');
    }
    if (input.newHireAfter65 && age >= 65) {
      notes.push('65세 이후 신규 입사자는 실업급여 보험료를 내지 않아 고용보험료를 공제하지 않았습니다.');
    }

    return { months, summary: summarize(months), notes };
  }

  function summarize(months) {
    const annualNet = months.reduce((acc, m) => acc + m.net, 0);
    const annualDeductions = months.reduce((acc, m) => acc + m.totalDeduction, 0);
    return {
      firstMonthNet: months[0].net,
      lastMonthNet: months[months.length - 1].net,
      averageNet: annualNet / months.length,
      annualNet,
      annualDeductions,
      varies: months.some((m) => Math.abs(m.net - months[0].net) > 0.5),
    };
  }

  function bisectSmallest(target, evaluate, lo, hi) {
    let a = Math.max(0, Math.floor(lo));
    let b = Math.max(1, Math.ceil(hi));
    let guard = 0;
    while (a > 0 && evaluate(a) >= target && guard++ < 60) a = a > 1 ? Math.floor(a / 2) : 0;
    guard = 0;
    while (evaluate(b) < target && guard++ < 60) b *= 2;
    let iterations = 0;
    while (b - a > 1 && iterations < 80) {
      const mid = Math.floor((a + b) / 2);
      if (evaluate(mid) >= target) b = mid;
      else a = mid;
      iterations++;
    }
    return { value: b, iterations };
  }

  function solve(target, evaluate) {
    if (!(target > 0)) {
      return { value: 0, iterations: 0, method: 'newton', result: null };
    }
    let g = target;
    let iterations = 0;
    let method = 'newton';
    let converged = false;

    // 간이세액표는 1,000~20,000원 폭의 계단이라 1만원 차분은 같은 행 안에 머물러
    // 기울기를 1로 잘못 읽는다. 여러 행을 넘는 10만원 차분으로 기울기를 잰다.
    const slopeStep = 100000;
    // 1원 단위 최소 금액 보정은 아래 루프가 하므로 뉴턴은 목표 근처에서 멈춘다.
    const nearTolerance = 1000;

    for (let i = 0; i < 8; i++) {
      const fg = evaluate(g);
      if (Math.abs(target - fg) < 10) {
        converged = true;
        break;
      }
      if (Math.abs(target - fg) <= nearTolerance) {
        converged = true;
        break;
      }
      if (fg >= target && evaluate(g - 1) < target) {
        converged = true;
        break;
      }
      const slope = (evaluate(g + slopeStep) - fg) / slopeStep;
      if (!(slope > 0)) break;
      g = g + (target - fg) / slope;
      if (!Number.isFinite(g) || g <= 0) break;
      iterations++;
    }

    if (!converged) {
      method = 'bisection';
      const bisected = bisectSmallest(target, evaluate, target, target * 2 + 1000000);
      g = bisected.value;
      iterations += bisected.iterations;
    }

    g = Math.floor(g);
    let up = 0;
    while (evaluate(g) < target && up < 20000) {
      g++;
      up++;
    }
    let down = 0;
    while (g > 0 && evaluate(g - 1) >= target && down < 2000) {
      g--;
      down++;
    }
    if (down >= 2000) {
      const bisected = bisectSmallest(target, evaluate, Math.max(0, g - 20000), g);
      g = bisected.value;
      iterations += bisected.iterations;
    }

    return { value: g, iterations, method, result: evaluate(g) };
  }

  function inverse(input) {
    const target = Number(input.monthlyNetTarget || 0);
    if ((input.workType || 'regular') === 'daily') {
      const evaluateForward = (wage) => forwardDaily({ ...input, daily: { ...(input.daily || {}), wage } });
      const solved = solve(target, (wage) => evaluateForward(wage).summary.averageNet);
      return {
        dailyWage: solved.value,
        monthlyWage: solved.value,
        annualGross: null,
        iterations: solved.iterations,
        method: solved.method,
        result: evaluateForward(solved.value),
      };
    }
    const evaluateForward = (monthlyGross) => forward({ ...input, annualGross: monthlyGross * 12 });
    const solved = solve(target, (monthlyGross) => evaluateForward(monthlyGross).summary.averageNet);
    return {
      annualGross: solved.value * 12,
      monthlyGross: solved.value,
      iterations: solved.iterations,
      method: solved.method,
      result: evaluateForward(solved.value),
    };
  }

  return {
    tableTax,
    childDeduction,
    withholdingTax,
    nontaxItems,
    productionEligibility,
    pensionCapFor,
    forward,
    inverse,
  };
}
