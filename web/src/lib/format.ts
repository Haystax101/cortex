export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fileIcon(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (["md", "markdown"].includes(ext)) return "📝";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼";
  if (ext === "pdf") return "📕";
  if (["json", "yml", "yaml", "toml"].includes(ext)) return "⚙️";
  if (["ts", "tsx", "js", "jsx", "py", "sh"].includes(ext)) return "🧩";
  return "📄";
}

export function toolIcon(name: string): string {
  switch (name) {
    case "Read": return "📖";
    case "Write": return "✍️";
    case "Edit": return "✏️";
    case "Glob": return "🗂";
    case "Grep": return "🔎";
    case "WebSearch": return "🌐";
    case "WebFetch": return "🌐";
    case "Bash": return "💻";
    case "Skill": return "⚡";
    case "Task": return "🤖";
    case "TodoWrite": return "📋";
    default: return "🔧";
  }
}
