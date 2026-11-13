/** 把任意字符串变成一个 POSIX sh 单引号字面量。 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
