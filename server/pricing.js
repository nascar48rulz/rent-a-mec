const STANDARD_RATE = 95;
const EXTENDED_RATE = 89;
const MAX_HOURS = 4;

function getQuote(hours) {
  const h = Math.min(Math.max(parseInt(hours, 10) || 1, 1), MAX_HOURS);
  const isExtended = h === 4;
  const rate = isExtended ? EXTENDED_RATE : STANDARD_RATE;
  return {
    hours: h,
    rate,
    total: rate * h,
    currency: 'USD',
    label: isExtended ? 'Extended rate (4-hr discount)' : 'Standard hourly rate',
    discountApplied: isExtended,
  };
}
module.exports = { getQuote, STANDARD_RATE, EXTENDED_RATE, MAX_HOURS };
