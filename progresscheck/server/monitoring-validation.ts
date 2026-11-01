// Additive JSON schema validation. Existing workspaces without monitoring remain valid.
export function validMonitoring(value: unknown): boolean {
  if (value === undefined) return true;
  const record = (x: any) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const str = (x: any, max = 2000) => typeof x === 'string' && x.length <= max;
  const date = (x: any) => str(x,10) && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
  const id = (x: any) => str(x,150) && x.length > 0;
  const stamp = (x: any) => str(x,40) && !isNaN(Date.parse(x));
  if (!record(value)) return false;
  return Object.entries(value as Record<string, any>).every(([scope, m]) => {
    if (!['real','sample'].includes(scope) || !record(m)) return false;
    if (m.nextDate !== undefined && !date(m.nextDate)) return false;
    if (m.planNote !== undefined && !str(m.planNote)) return false;
    if (!Array.isArray(m.routines) || m.routines.length > 200 || !Array.isArray(m.logs) || m.logs.length > 5000 || !Array.isArray(m.reviews) || m.reviews.length > 1000) return false;
    const ids = new Set<string>(), logKeys = new Set<string>();
    for (const r of m.routines) {
      if (!record(r) || !id(r.id) || ids.has(r.id) || !str(r.name,120) || !r.name.trim() || !['Treatment','Haircare','Other'].includes(r.type) || !date(r.startDate) || !['daily','weekly','as-needed'].includes(r.frequency) || !str(r.notes) || !stamp(r.createdAt)) return false;
      ids.add(r.id);
    }
    for (const l of m.logs) {
      if (!record(l) || !id(l.id) || !ids.has(l.routineId) || !date(l.date) || !Number.isInteger(l.planned) || !Number.isInteger(l.completed) || l.planned < 0 || l.planned > 20 || l.completed < 0 || l.completed > l.planned || !str(l.experience) || !str(l.sideEffects) || !stamp(l.createdAt)) return false;
      const r = m.routines.find((r: any) => r.id === l.routineId);
      const key = l.routineId + '/' + l.date;
      if (l.date < r.startDate || logKeys.has(key)) return false;
      logKeys.add(key);
    }
    return m.reviews.every((r: any) => record(r) && id(r.id) && id(r.sessionId) && str(r.questions) && r.questions.trim() && (r.consultation === null || date(r.consultation)) && stamp(r.createdAt) && r.status === 'prepared_not_sent');
  });
}
