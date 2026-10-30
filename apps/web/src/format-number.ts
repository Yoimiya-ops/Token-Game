const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, useGrouping: false });
const units = [{ value: 1e9, suffix: 'B' }, { value: 1e6, suffix: 'M' }, { value: 1e3, suffix: 'K' }];

export function compactNumber(value: number): string {
  // Promote rounded boundary values instead of showing 1000K or 1000M.
  let index = units.findIndex(unit => Math.abs(value) >= unit.value);
  if (index > 0 && Math.round(Math.abs(value) / units[index]!.value * 10) / 10 >= 1000) index--;
  const unit = units[index];
  return unit ? decimal.format(value / unit.value) + unit.suffix : decimal.format(value);
}
