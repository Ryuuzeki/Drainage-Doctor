/** Token-preserving SWMM input editing. Parameter indexes follow EPA SWMM 5.2 Appendix D. */
export type InpRow = {section:string; tokens:string[]; line:number};
export const sameId = (a:string,b:string) => a.toUpperCase() === b.toUpperCase();
export function readInp(input:string) {
  let section = '';
  const lines = input.split(/(?<=\n)/), rows:InpRow[] = [];
  lines.forEach((line,i) => {
    const content = line.split(';')[0].trim();
    if (content.startsWith('[')) { section = content.toUpperCase(); return; }
    if (content) rows.push({section,tokens:content.split(/\s+/),line:i});
  });
  return {lines,rows};
}
export function setToken(lines:string[],row:InpRow,index:number,value:number|string) {
  const line = lines[row.line], content = line.split(';')[0];
  const token = [...content.matchAll(/\S+/g)][index];
  if (!token) throw new Error(`Missing explicit parameter ${index} at ${row.section} ${row.tokens[0]}.`);
  lines[row.line] = line.slice(0,token.index) + value + line.slice(token.index! + token[0].length);
  row.tokens[index] = String(value);
}
export const rowsIn = (rows:InpRow[],section:string) => rows.filter(r=>r.section===`[${section}]`);
export const optionValue = (rows:InpRow[],key:string) => rowsIn(rows,'OPTIONS').find(r=>sameId(r.tokens[0],key))?.tokens[1];
export async function sha256(value:string|ArrayBuffer) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
