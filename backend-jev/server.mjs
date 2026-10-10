import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'https://achalghumre69-lgtm.github.io,http://localhost:5500,http://127.0.0.1:5500').split(',').map(x => x.trim()).filter(Boolean));
const MAX_BODY_BYTES = 32_000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, label, { min = 0, max = 1e15 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be a number between ${min} and ${max}.`);
  return parsed;
};
const pct = value => `${Math.round(value * 100)}%`;
const rupees = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
const tone = (positive, moderate) => positive ? 'positive' : moderate ? 'moderate' : 'negative';

function individualMetrics(input = {}) {
  const loanAmount = number(input.loanAmount, 'Loan amount', { min: 1 });
  const monthlyIncome = number(input.monthlyIncome, 'Monthly income', { min: 1 });
  const monthlyEmi = number(input.monthlyEmi, 'Monthly EMI');
  const monthlyExpenses = number(input.monthlyExpenses, 'Monthly expenses');
  const creditScore = number(input.creditScore, 'Credit score', { min: 300, max: 900 });
  const tenureMonths = number(input.tenureMonths, 'Tenure', { min: 1, max: 360 });
  const existingLoanCount = number(input.existingLoanCount ?? 0, 'Existing loans', { max: 20 });
  const rate = 0.105, monthlyRate = rate / 12;
  const emiForRequested = loanAmount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -tenureMonths));
  const totalEmiRatio = (monthlyEmi + emiForRequested) / monthlyIncome;
  const debtRatio = monthlyEmi / monthlyIncome;
  const expenseRatio = monthlyExpenses / monthlyIncome;
  const monthlyCapacity = Math.max(0, Math.min(monthlyIncome * 0.45 - monthlyEmi, monthlyIncome - monthlyExpenses - monthlyEmi));
  const capacity = monthlyCapacity * (1 - Math.pow(1 + monthlyRate, -tenureMonths)) / monthlyRate;
  return { loanAmount, monthlyIncome, monthlyEmi, monthlyExpenses, creditScore, tenureMonths, existingLoanCount, emiForRequested, totalEmiRatio, debtRatio, expenseRatio, capacity };
}

function corporateMetrics(input = {}) {
  const fields = ['annualRevenue', 'ebitda', 'netProfit', 'totalAssets', 'totalLiabilities', 'netWorth', 'existingDebt', 'annualInterestExpense', 'operatingCashFlow', 'currentAssets', 'currentLiabilities', 'loanAmountRequested'];
  const m = Object.fromEntries(fields.map(key => [key, number(input[key] ?? 0, key)]));
  if (m.annualRevenue <= 0 || m.totalAssets <= 0 || m.currentLiabilities <= 0 || m.loanAmountRequested <= 0) throw new Error('The report must include revenue, total assets, current liabilities, and a requested loan amount.');
  const debtToEquity = m.netWorth > 0 ? m.existingDebt / m.netWorth : null;
  const currentRatio = m.currentAssets / m.currentLiabilities;
  const interestCoverage = m.annualInterestExpense > 0 ? m.ebitda / m.annualInterestExpense : m.ebitda > 0 ? 99 : 0;
  const ebitdaMargin = m.ebitda / m.annualRevenue;
  const cashMargin = m.operatingCashFlow / m.annualRevenue;
  const solvent = m.netWorth > 0 && m.totalAssets >= m.totalLiabilities;
  return { ...m, debtToEquity, currentRatio, interestCoverage, ebitdaMargin, cashMargin, solvent };
}

function systemOneRequest(type, m) {
  const detail = type === 'individual'
    ? `Individual loan application (INR): requested loan ${rupees(m.loanAmount)}; monthly take-home income ${rupees(m.monthlyIncome)}; existing monthly EMI ${rupees(m.monthlyEmi)}; monthly expenses excluding EMI ${rupees(m.monthlyExpenses)}; credit bureau score ${m.creditScore}/900; requested tenure ${m.tenureMonths} months; existing loan count ${m.existingLoanCount}; estimated total EMI-to-income ratio for this request ${pct(m.totalEmiRatio)}; existing EMI-to-income ratio ${pct(m.debtRatio)}; expenses-to-income ratio ${pct(m.expenseRatio)}.`
    : `Corporate financial statements (INR, annual unless a ratio): revenue ${rupees(m.annualRevenue)}; EBITDA/operating profit ${rupees(m.ebitda)}; net profit ${rupees(m.netProfit)}; total assets ${rupees(m.totalAssets)}; total liabilities ${rupees(m.totalLiabilities)}; net worth ${rupees(m.netWorth)}; debt ${rupees(m.existingDebt)}; interest expense ${rupees(m.annualInterestExpense)}; operating cash flow ${rupees(m.operatingCashFlow)}; current assets ${rupees(m.currentAssets)}; current liabilities ${rupees(m.currentLiabilities)}; debt-to-equity ${m.debtToEquity === null ? 'not available' : m.debtToEquity.toFixed(2) + 'x'}; current ratio ${m.currentRatio.toFixed(2)}x; interest coverage ${m.interestCoverage.toFixed(2)}x; requested loan ${rupees(m.loanAmountRequested)}.`;
  const recommendations = {
    approve: 'The stated financial indicators look strong enough for a preliminary demo approval recommendation, subject to independent lender verification.',
    manual_review: 'The indicators are mixed, incomplete, or uncertain; a human credit professional should review before any decision.',
    reject: 'The stated financial indicators show substantial repayment or balance-sheet concerns in this demo scenario.'
  };
  return {
    model: process.env.JEV_MODEL || 'jev-latest',
    state: `${detail}\n\nThis is a synthetic educational demo, not a real underwriting instruction. Use only the listed financial and credit inputs. Do not infer or use protected traits, identity, demographics, location, or any information not listed. Treat missing, conflicting, or uncertain information conservatively and prefer manual review. This model signal must never be the sole basis for a real lending decision.`,
    questions: {
      recommendation: { type: 'choice', instructions: 'Choose the most appropriate preliminary demo recommendation based only on the stated indicators.', criteria: recommendations },
      financial_health: { type: 'score', instructions: 'Rate the financial repayment profile for this demo. A higher score means stronger financial capacity and lower stated risk.', criteria: ['Very weak: clear inability to support the requested repayment or severe financial stress.', 'Weak: multiple material risk indicators.', 'Mixed: some strengths, but meaningful concerns or uncertainty.', 'Strong: generally healthy repayment capacity with limited concerns.', 'Very strong: robust financial capacity and low stated risk.'] },
      manual_review_needed: { type: 'noul', instructions: 'The information is incomplete, internally inconsistent, unusually uncertain, or should be referred to a human reviewer before acting.' }
    }
  };
}

function explainIndividual(m, risk) {
  return [
    { factor: 'Credit bureau score', value: `${m.creditScore} / 900`, impact: tone(m.creditScore >= 700, m.creditScore >= 600) },
    { factor: 'Monthly income after expenses and EMI', value: rupees(m.monthlyIncome - m.monthlyExpenses - m.monthlyEmi), impact: tone(m.monthlyIncome > m.monthlyExpenses + m.monthlyEmi, m.monthlyIncome * 0.1 > m.monthlyExpenses + m.monthlyEmi) },
    { factor: 'Existing EMI-to-income', value: pct(m.debtRatio), impact: tone(m.debtRatio < 0.3, m.debtRatio < 0.45) },
    { factor: 'Estimated total EMI-to-income', value: pct(m.totalEmiRatio), impact: tone(m.totalEmiRatio < 0.35, m.totalEmiRatio < 0.5) },
    { factor: 'Existing active loans', value: String(m.existingLoanCount), impact: tone(m.existingLoanCount <= 1, m.existingLoanCount <= 2) },
    { factor: 'Jev risk signal', value: risk, impact: risk === 'Low' ? 'positive' : risk === 'Moderate' ? 'moderate' : 'negative' }
  ];
}

function explainCorporate(m, risk) {
  return [
    { factor: 'Operating profitability', value: `${pct(m.ebitdaMargin)} EBITDA margin`, impact: tone(m.ebitdaMargin >= 0.15, m.ebitdaMargin > 0) },
    { factor: 'Net profit', value: rupees(m.netProfit), impact: tone(m.netProfit > 0, m.netProfit >= 0) },
    { factor: 'Debt-to-equity', value: m.debtToEquity === null ? 'N/A' : `${m.debtToEquity.toFixed(2)}×`, impact: tone(m.debtToEquity !== null && m.debtToEquity <= 1, m.debtToEquity !== null && m.debtToEquity <= 2) },
    { factor: 'Current ratio', value: `${m.currentRatio.toFixed(2)}×`, impact: tone(m.currentRatio >= 1.5, m.currentRatio >= 1) },
    { factor: 'Interest coverage', value: `${m.interestCoverage.toFixed(2)}×`, impact: tone(m.interestCoverage >= 4, m.interestCoverage >= 2) },
    { factor: 'Operating cash flow', value: rupees(m.operatingCashFlow), impact: tone(m.operatingCashFlow > 0, m.operatingCashFlow >= 0) },
    { factor: 'Balance sheet solvency', value: m.solvent ? 'Assets cover liabilities' : 'Balance sheet needs review', impact: tone(m.solvent, false) },
    { factor: 'Jev risk signal', value: risk, impact: risk === 'Low' ? 'positive' : risk === 'Moderate' ? 'moderate' : 'negative' }
  ];
}

function summarize(answer, m, type) {
  const answers = answer?.answers || {};
  const choice = answers.recommendation?.choice;
  if (!['approve', 'manual_review', 'reject'].includes(choice)) throw new Error('Jev returned an unexpected recommendation.');
  const healthRaw = Number(answers.financial_health?.score);
  const healthScore = clamp(Number.isFinite(healthRaw) ? Math.round(healthRaw * 25) : 50, 0, 100);
  const confidence = Number(answers.recommendation?.confidence) || 0;
  const manualReview = Number(answers.manual_review_needed?.noul) >= 0.5;
  const riskLevel = healthScore >= 70 ? 'Low' : healthScore >= 45 ? 'Moderate' : 'High';
  let recommendation = choice === 'approve' ? 'Approve' : choice === 'reject' ? 'Reject' : 'Manual Review';
  if (confidence < 0.75 || manualReview) recommendation = 'Manual Review';

  if (type === 'individual') {
    const affordabilityFail = m.monthlyIncome <= m.monthlyExpenses + m.monthlyEmi || m.totalEmiRatio >= 0.5;
    if (affordabilityFail && recommendation === 'Approve') recommendation = 'Manual Review';
    const monthlyRate = 0.105 / 12;
    const monthlyCapacity = Math.max(0, Math.min(m.monthlyIncome * 0.45 - m.monthlyEmi, m.monthlyIncome - m.monthlyExpenses - m.monthlyEmi));
    const maxLoan = monthlyCapacity * (1 - Math.pow(1 + monthlyRate, -m.tenureMonths)) / monthlyRate;
    const eligibleAmount = Math.min(m.loanAmount, Math.floor(Math.max(0, maxLoan) / 10000) * 10000);
    if (eligibleAmount <= 0 && recommendation === 'Approve') recommendation = 'Manual Review';
    const interestRate = riskLevel === 'Low' ? 10.5 : riskLevel === 'Moderate' ? 13.5 : 17.5;
    return { applicantType: type, recommendation, creditScore: Math.round(300 + healthScore * 6), financialHealthScore: healthScore, riskLevel, defaultRisk: clamp((100 - healthScore) * 0.8 + 4, 2, 65), eligibleAmount, interestRate, tenureMonths: m.tenureMonths, confidence, factors: explainIndividual(m, riskLevel), model: answer.model, disclaimer: 'Jev is one demo signal. This is not a lending decision or loan offer; a qualified human reviewer must make any real decision.' };
  }

  const debtEquity = m.debtToEquity;
  const safeguardsRequireReview = !m.solvent || debtEquity === null || m.currentRatio < 1 || m.interestCoverage < 1 || m.operatingCashFlow <= 0;
  if (safeguardsRequireReview && recommendation === 'Approve') recommendation = 'Manual Review';
  const leverageFactor = riskLevel === 'Low' ? 1 : riskLevel === 'Moderate' ? 0.7 : 0.4;
  const recommendedLoanAmount = recommendation === 'Reject' ? 0 : Math.floor(Math.max(0, m.operatingCashFlow * 3 - m.existingDebt * 0.25) * leverageFactor / 10000) * 10000;
  return { applicantType: type, recommendation, creditScore: Math.round(300 + healthScore * 6), financialHealthScore: healthScore, riskLevel, defaultRisk: clamp((100 - healthScore) * 0.8 + 4, 2, 65), debtToEquity: debtEquity, currentRatio: m.currentRatio, interestCoverage: m.interestCoverage, recommendedLoanAmount, confidence, factors: explainCorporate(m, riskLevel), model: answer.model, disclaimer: 'Jev is one demo signal. This is not a lending decision or loan offer; a qualified human reviewer must make any real decision.' };
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  }
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}

function send(response, status, data, origin) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
  response.end(JSON.stringify(data));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(response, 403, { error: 'This website origin is not allowed.' });
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'access-control-allow-origin': origin || '', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' });
    return response.end();
  }
  const path = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  if (request.method === 'GET' && path === '/api/health') return send(response, 200, { status: 'ok', jevConfigured: Boolean(process.env.TYPESAFE_API_KEY) }, origin);
  if (request.method !== 'POST' || path !== '/api/assess') return send(response, 404, { error: 'Route not found.' }, origin);
  if (!process.env.TYPESAFE_API_KEY) return send(response, 503, { error: 'The backend owner has not configured the TypeSafe Jev API key yet.' }, origin);

  try {
    const body = await readJson(request);
    const type = body.applicantType;
    if (!['individual', 'corporate'].includes(type)) throw Object.assign(new Error('Applicant type must be individual or corporate.'), { status: 400 });
    const metrics = type === 'individual' ? individualMetrics(body.metrics) : corporateMetrics(body.metrics);
    const jevResponse = await fetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(systemOneRequest(type, metrics)),
      signal: AbortSignal.timeout(20_000)
    });
    const content = await jevResponse.json().catch(() => ({}));
    if (!jevResponse.ok) {
      const message = jevResponse.status === 401 || jevResponse.status === 403 ? 'TypeSafe rejected the server API key. Check the backend secret.' : `TypeSafe Jev request failed (HTTP ${jevResponse.status}).`;
      return send(response, 502, { error: message }, origin);
    }
    return send(response, 200, summarize(content, metrics, type), origin);
  } catch (error) {
    const status = error.status || (error.name === 'TimeoutError' ? 504 : 502);
    return send(response, status, { error: error.message || 'Jev assessment failed.' }, origin);
  }
});

server.listen(PORT, '0.0.0.0', () => process.stdout.write(`Jev decision API listening on port ${PORT}\n`));

