export type Task = { id: string; title: string; date: string; notes: string; category: string; subcategory: string; urgent: boolean; time: string; done: boolean; created: number };
export type TaskEdit = { title: string; date: string; notes: string; category: string; subcategory: string; urgent: boolean; time: string };
export type Category = { name: string; children: string[] };
export type State = { version: 1; tasks: Task[]; categories: Category[] };
export const defaults: Category[] = [
  { name: 'Personal', children: ['Home', 'Errands', 'Health'] },
  { name: 'Work', children: ['Admin', 'Projects', 'Meetings'] },
  { name: 'Creative', children: ['Content', 'Music', 'Ideas'] },
];
export const today = () => dateKey(new Date());
export function dateKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function localDate(value: string) { return new Date(`${value}T12:00:00`); }
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dateKey(localDate(value)) === value;
}
export function isTask(t: unknown): t is Task {
  if (!t || typeof t !== 'object') return false;
  const v = t as Task;
  return typeof v.id === 'string' && typeof v.title === 'string' && v.title.trim().length > 0 && v.title.length <= 500 && (v.date === '' || isDate(v.date)) && typeof v.notes === 'string' && v.notes.length <= 10000 && typeof v.category === 'string' && typeof v.subcategory === 'string' && typeof v.urgent === 'boolean' && (v.time === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)) && typeof v.done === 'boolean' && Number.isFinite(v.created);
}
function cleanTask(v: Task): Task {
  return {id:v.id, title:v.title, date:v.date, notes:v.notes, category:v.category, subcategory:v.subcategory, urgent:v.urgent, time:v.time, done:v.done, created:v.created};
}
export function parseState(raw: string): State {
  const s = JSON.parse(raw) as State;
  if (s.version !== 1 || !Array.isArray(s.tasks) || s.tasks.length > 20000 || !s.tasks.every(isTask) || new Set(s.tasks.map(t=>t.id)).size !== s.tasks.length || !Array.isArray(s.categories) || !s.categories.every(c=>typeof c.name === 'string' && c.name.trim().length > 0 && Array.isArray(c.children) && c.children.every(x=>typeof x === 'string'))) throw new Error('This is not a valid checklist backup.');
  return {version:1, tasks:s.tasks.map(cleanTask), categories:s.categories.map(c=>({name:c.name, children:[...c.children]}))};
}
export function requireCategoryName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a category name.');
  if (trimmed.length > 80) throw new Error('That category name is too long.');
  return trimmed;
}
export function categoryChoices(names: string[], current: string) {
  const choices = [''];
  for (const name of names) if (name && !choices.includes(name)) choices.push(name);
  if (current && !choices.includes(current)) choices.push(current);
  return choices;
}
export function applyTaskEdit(task: Task, edit: TaskEdit): Task {
  const title = edit.title.trim();
  if (!title) throw new Error('Enter a task title.');
  if (title.length > 500) throw new Error('That title is too long.');
  const date = edit.date.trim();
  if (date && !isDate(date)) throw new Error('Enter a valid date.');
  const time = edit.time.trim();
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter a valid time.');
  if (typeof edit.notes !== 'string' || edit.notes.length > 10000) throw new Error('Those notes are too long.');
  return {...task, title, date, notes:edit.notes, category:edit.category, subcategory:edit.subcategory.trim(), urgent:edit.urgent, time};
}
export function escapeHtml(value: string) { return value.replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!)); }
export function sortTasks(tasks: Task[]) { return [...tasks].sort((a,b)=>Number(a.done)-Number(b.done) || Number(b.urgent)-Number(a.urgent) || (a.date||'9999').localeCompare(b.date||'9999') || (a.time||'99').localeCompare(b.time||'99') || a.created-b.created); }
function icalText(s: string) { return s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,'); }
export function calendarFile(tasks: Task[]) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//WILL DO//Daily checklist//EN','CALSCALE:GREGORIAN'];
  for(const t of tasks.filter(t=>t.date && !t.done)) {
    const stamp=t.date.replaceAll('-','');
    const end=localDate(t.date); end.setDate(end.getDate()+1);
    lines.push('BEGIN:VEVENT',`UID:${icalText(t.id)}@auny-daily-checklist`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z')}`,
      t.time ? `DTSTART:${stamp}T${t.time.replace(':','')}00` : `DTSTART;VALUE=DATE:${stamp}`,
      ...(t.time ? ['DURATION:PT30M'] : [`DTEND;VALUE=DATE:${dateKey(end).replaceAll('-','')}`]),
      `SUMMARY:${icalText(t.title)}`,`DESCRIPTION:${icalText(t.notes)}`,'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 folds content lines by UTF-8 octets, including multibyte characters.
  return lines.map(line=>{let out='',n=0; for(const ch of line){const bytes=new TextEncoder().encode(ch).length; if(n+bytes>73){out+='\r\n ';n=1;}out+=ch;n+=bytes;}return out;}).join('\r\n')+'\r\n';
}
export function calendarLink(t: Task) {
  const p = new URLSearchParams({action:'TEMPLATE',text:t.title,details:t.notes});
  if(t.date){ const d=t.date.replaceAll('-',''); const e=localDate(t.date);e.setDate(e.getDate()+1);
    if(t.time){const start=new Date(`${t.date}T${t.time}:00`);const end=new Date(start.getTime()+30*60*1000);const utc=(v:Date)=>v.toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z');p.set('dates',`${utc(start)}/${utc(end)}`);}
    else p.set('dates',`${d}/${dateKey(e).replaceAll('-','')}`);
  }
  return `https://calendar.google.com/calendar/render?${p}`;
}
