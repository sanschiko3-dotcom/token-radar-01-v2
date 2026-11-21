const omittedCategories = new Set([
 'Bridge', 'Canonical Bridge', 'Liquid Staking',
 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);

export function boardCandidate(record, watched) {
 if (watched.includes(record.slug)) return true;
 const unlisted = record.mcap_usd === null;
 const tokenAbsent = !record.gecko_id && !record.symbol;
 const categoryAllowed = !omittedCategories.has(record.category);
 const derivativeName = /\b(?:wrapped|staked|staking)\b/i.test(record.name);
 const versionName = /\s(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i.test(record.name);
 const exchangeName = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i.test(record.name);
 const nameAllowed = !derivativeName && !versionName && !exchangeName;
 return unlisted && tokenAbsent && categoryAllowed && nameAllowed;
}

export function classifyVerdict(profit, hourlyProfit) {
 if (hourlyProfit >= 10) return 'FARM';
 if (profit > 0) return 'THIN';
 return 'SKIP';
}

export function farmPlan(record, transactionCost) {
 const {name, category, chains} = record;
 const destination = chains[0] || 'supported chain';
 const product = category || 'protocol';
 return [
  `Verify ${name} official deployment and eligibility; no allocation is guaranteed.`,
  `Deposit $250 on ${destination} only after reviewing withdrawal and contract risks.`,
  `Use its ${product} product once weekly for four weeks; budget two hours and $${transactionCost} in transaction fees.`,
  'Withdraw a small amount first; stop if fees exceed the budget or eligibility remains unverified.',
 ];
}

export function checkCoverage(entries, watched) {
 const present = new Set(entries.map(entry => entry.slug));
 const complete = watched.every(identifier => present.has(identifier));
 if (entries.length === 198 && complete) return;
 throw new Error('Coverage self-test failed');
}
