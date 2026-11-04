export function workingDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), remainder = total % 60;
  return `${hours}h ${minutes}m${remainder ? ` ${remainder}s` : ''}`;
}
export function hoursPreview(value) {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(String(value)) || Number(value) > 24) return 'Enter 0–24 decimal hours (up to two decimal places).';
  return workingDuration(Math.round(Number(value) * 3600));
}
