// Cohorts include every record, including protocols without a listed token.
const populationRate = 144 / 758;
const priorWeight = 20;

export function listingCohorts(snapshot) {
 const observedAt = Date.parse(snapshot.as_of);
 const elapsedDays = (record) => {
  if (!record.listed_at) return 1000;
  const duration = observedAt - Date.parse(record.listed_at);
  return Math.max(1, duration / 86400000);
 };

 const cohortName = (record) => {
  const sizeGroup = record.tvl_usd >= 100000000;
  const maturityGroup = elapsedDays(record) >= 730;
  return [record.category, sizeGroup, maturityGroup].join('|');
 };

 const counts = new Map();
 for (const record of snapshot.protocols) {
  const label = cohortName(record);
  if (!counts.has(label)) counts.set(label, [0, 0]);
  const totals = counts.get(label);
  totals[0] += 1;
  if (record.mcap_usd !== null) totals[1] += 1;
 }

 const probability = (totals) => {
  const numerator = totals[1] + priorWeight * populationRate;
  const denominator = totals[0] + priorWeight;
  const estimate = numerator / denominator;
  return Math.max(0.05, Math.min(0.95, estimate));
 };

 return {
  age: elapsedDays,
  key: cohortName,
  buckets: counts,
  listingOdds: probability,
 };
}
