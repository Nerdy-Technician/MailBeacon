/** Linear-time trims, used instead of anchored regexes like /\/+$/ on user input. */
export const trimEnd = (s: string, ch: string): string => {
  let e = s.length;
  while (e > 0 && s[e - 1] === ch) e--;
  return s.slice(0, e);
};
export const trimBoth = (s: string, ch: string): string => {
  let b = 0;
  while (b < s.length && s[b] === ch) b++;
  return trimEnd(s.slice(b), ch);
};
export const stripSlashes = (u: string): string => trimEnd(u, "/");
