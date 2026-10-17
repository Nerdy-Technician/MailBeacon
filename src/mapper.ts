import TurndownService from "turndown";

export interface Mapped { title: string; message: string; contentType: "text/plain" | "text/markdown" }

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
td.remove(["script", "style", "head", "title"]);

export function htmlToMarkdown(html: string): string {
  return td.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}

export function mapMail(subject: string | undefined, text: string | undefined, html: string | false | undefined, maxChars = 64000): Mapped {
  const title = (subject ?? "").trim() || "(no subject)";
  let message: string;
  let contentType: Mapped["contentType"] = "text/plain";
  if (text && text.trim()) message = text.trim();
  else if (html) { message = htmlToMarkdown(html); contentType = "text/markdown"; }
  else message = "(empty message)";
  if (message.length > maxChars) message = message.slice(0, maxChars) + "\n…(truncated)";
  return { title, message, contentType };
}
